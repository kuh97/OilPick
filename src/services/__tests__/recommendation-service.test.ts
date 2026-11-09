import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../route-service", () => ({ getRoute: vi.fn() }));
vi.mock("../station-service", () => ({ collectStations: vi.fn() }));
vi.mock("../price-service", () => ({ computeReferencePrice: vi.fn() }));
vi.mock("../event-service", () => ({ logSearch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/infra/db/repositories", () => ({
  findNearestRoadLinkProbes: vi.fn(),
}));
vi.mock("@/infra/valhalla/client", () => ({
  fetchValhallaRoute: vi.fn(),
  mapMatchValhallaRoute: vi.fn(),
}));

import { search, type ProgressEvent } from "../recommendation-service";
import { getRoute } from "../route-service";
import { collectStations } from "../station-service";
import { computeReferencePrice } from "../price-service";
import { logSearch } from "../event-service";
import { findNearestRoadLinkProbes } from "@/infra/db/repositories";
import {
  fetchValhallaRoute,
  mapMatchValhallaRoute,
} from "@/infra/valhalla/client";
import { ON_ROUTE_PREFILTER_MAX_M, T2_MAX } from "@/domain/params";
import { wgs84 } from "@/domain/types";
import type { BaseRoute, Fuel, RefuelPoint, SearchInput } from "@/domain/types";
import type { RedisLike } from "../route-service";
import type { Db } from "@/infra/db/client";

const getRouteMock = vi.mocked(getRoute);
const collectStationsMock = vi.mocked(collectStations);
const computeReferencePriceMock = vi.mocked(computeReferencePrice);
const logSearchMock = vi.mocked(logSearch);
const findNearestRoadLinkProbesMock = vi.mocked(findNearestRoadLinkProbes);
const fetchValhallaRouteMock = vi.mocked(fetchValhallaRoute);
const mapMatchValhallaRouteMock = vi.mocked(mapMatchValhallaRoute);

function fakeRedis(): RedisLike {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
    incrby: async () => 1,
    expire: async () => 1,
  };
}

const FAKE_DEPS = {
  redis: fakeRedis(),
  db: {} as Db,
  now: new Date("2026-08-31T03:00:00.000Z"),
  valhallaBaseUrl: "http://valhalla.test",
  valhallaConcurrency: 2,
};

const BASE_ROUTE: BaseRoute = {
  distanceM: 26_400,
  durationS: 1_800,
  polyline: [wgs84(37.0, 127.0), wgs84(37.0, 127.3)],
};

function station(overrides: Partial<RefuelPoint> = {}): RefuelPoint {
  return {
    id: "A0000001",
    name: "테스트주유소",
    brandCode: "SKE",
    energyType: "OIL",
    location: wgs84(37.0, 127.15),
    facilities: { carWash: false, maintenance: false, cvs: false },
    isKpetro: false,
    ...overrides,
  };
}

function collected(
  overrides: Partial<RefuelPoint> & { price?: number; pricedOn?: string | null } = {},
) {
  const { price = 1700, pricedOn = "2026-08-30", ...stationOverrides } = overrides;
  return { station: station(stationOverrides), price, pricedOn };
}

const VEHICLE = {
  fuel: "GASOLINE" as Fuel,
  efficiencyKmPerL: 10,
  refuelAmountL: 45,
  timeValuePerMin: 200,
};

function baseInput(overrides: Partial<SearchInput> = {}): SearchInput {
  return {
    origin: wgs84(37.0, 127.0),
    destination: wgs84(37.0, 127.3),
    vehicle: VEHICLE,
    filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    mode: "balanced",
    avoidHighway: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  FAKE_DEPS.redis = fakeRedis();
  getRouteMock.mockResolvedValue(BASE_ROUTE);
  mapMatchValhallaRouteMock.mockResolvedValue(BASE_ROUTE);
  fetchValhallaRouteMock.mockImplementation(async ({ waypoint }) =>
    waypoint && waypoint.lat !== 37.0
      ? {
          ...BASE_ROUTE,
          distanceM: BASE_ROUTE.distanceM + 2_000,
          durationS: BASE_ROUTE.durationS + 240,
        }
      : BASE_ROUTE,
  );
  computeReferencePriceMock.mockResolvedValue({ price: 1900, source: "MEDIAN_T1T2" });
  findNearestRoadLinkProbesMock.mockResolvedValue([]);
  logSearchMock.mockResolvedValue(undefined);
});

describe("search — Valhalla map-match와 후보 경로", () => {
  it("고유 기본 경로 전체를 map-match하고 후보별 Valhalla 경유 경로를 계산한다", async () => {
    const pool = Array.from({ length: 2 }, (_, i) =>
      collected({
        id: `S${i}`,
        location: wgs84(37.0, 127.01 + i * 0.01),
        price: 1600 + i,
      }),
    );
    collectStationsMock.mockResolvedValue({ stations: pool });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(getRouteMock).toHaveBeenCalledTimes(3);
    expect(getRouteMock.mock.calls.every(([options]) => options.waypoint == null)).toBe(true);
    expect(mapMatchValhallaRouteMock).toHaveBeenCalledTimes(1);
    expect(mapMatchValhallaRouteMock.mock.calls[0][0].polyline).toEqual(BASE_ROUTE.polyline);
    expect(fetchValhallaRouteMock).toHaveBeenCalledTimes(2);
    expect(result.candidates.every((candidate) => candidate.detour.precise === false)).toBe(true);
  });

  it("map-match 기준 경로와 실제 경유 경로 차이로 경로상 후보를 판정한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "ON_ROUTE", location: wgs84(37.0, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["ON_ROUTE"]);
    expect(result.candidates[0].tier).toBe("ON_ROUTE");
    expect(result.candidates[0].detour).toMatchObject({
      distanceM: 0,
      durationS: 0,
      precise: false,
    });
    expect(collectStationsMock.mock.calls.map(([options]) => options.marginM)).toEqual([
      ON_ROUTE_PREFILTER_MAX_M,
      T2_MAX,
    ]);
  });

  it("경로상 후보가 없을 때만 T3 범위로 확장한다", async () => {
    const margins: number[] = [];
    collectStationsMock.mockImplementation(async ({ marginM }) => {
      margins.push(marginM);
      if (marginM === 8_000) {
        return {
          stations: [
            collected({ id: "EXPANDED", location: wgs84(37.05, 127.15), price: 1500 }),
          ],
        };
      }
      return { stations: [] };
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(margins).toEqual([ON_ROUTE_PREFILTER_MAX_M, T2_MAX, 8_000]);
    expect(result.stage).toBe("DETOUR");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual([
      "EXPANDED",
    ]);
  });

  it("STAGE 2 후보는 Valhalla ΔT·ΔD가 작아도 우회로 표시한다", async () => {
    collectStationsMock.mockImplementation(async ({ marginM }) => {
      if (marginM === 8_000) {
        return {
          stations: [
            collected({
              id: "EXPANDED_ON_ROUTE",
              location: wgs84(37.05, 127.15),
            }),
          ],
        };
      }
      return { stations: [] };
    });
    fetchValhallaRouteMock.mockResolvedValue({
      ...BASE_ROUTE,
      distanceM: BASE_ROUTE.distanceM + 1_000,
      durationS: BASE_ROUTE.durationS + 60,
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.expansion.triggered).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      station: { id: "EXPANDED_ON_ROUTE" },
      tier: "DETOUR",
      detour: { distanceM: 1_000, durationS: 60, precise: false },
    });
  });

  it("폴리라인 가까운 후보라도 실제 ΔT·ΔD가 크면 우회로 분류한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "DETOUR", location: wgs84(37.003, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates[0]).toMatchObject({
      station: { id: "DETOUR" },
      tier: "DETOUR",
      detour: { distanceM: 2_000, durationS: 240, precise: false },
    });
  });

  it("Valhalla가 경로상으로 판정해도 최근접 도로가 반대 방향이면 우회로 보존한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "OPPOSITE", location: wgs84(37.001, 127.15) })],
    });
    findNearestRoadLinkProbesMock.mockResolvedValue([
      {
        stationId: "OPPOSITE",
        distanceM: 50,
        headingRad: -Math.PI / 2,
      },
    ]);

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      station: { id: "OPPOSITE" },
      tier: "DETOUR",
      detour: { distanceM: 2_000, durationS: 240, precise: false },
    });
  });

  it("최근접 도로가 같은 방향이면 기존 경로상 판정을 유지한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "SAME", location: wgs84(37.0, 127.15) })],
    });
    findNearestRoadLinkProbesMock.mockResolvedValue([
      {
        stationId: "SAME",
        distanceM: 50,
        headingRad: Math.PI / 2,
      },
    ]);

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates[0]).toMatchObject({
      station: { id: "SAME" },
      tier: "ON_ROUTE",
    });
  });

  it("후보별 Valhalla 실패가 있어도 성공한 후보는 보존한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "OK", location: wgs84(37.0, 127.1) }),
        collected({ id: "FAILED", location: wgs84(37.002, 127.2) }),
      ],
    });
    fetchValhallaRouteMock.mockImplementation(async ({ waypoint }) => {
      if (waypoint?.lat !== 37.0) throw new Error("candidate route failed");
      return BASE_ROUTE;
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["OK"]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "VALHALLA_PARTIAL" }),
    );
  });

  it("같은 검색을 반복하면 Valhalla map-match·경유 경로 캐시를 재사용한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "CACHED", location: wgs84(37.0, 127.1) })],
    });

    await search(baseInput(), undefined, FAKE_DEPS);
    const mapMatchCalls = mapMatchValhallaRouteMock.mock.calls.length;
    const routeCalls = fetchValhallaRouteMock.mock.calls.length;

    await search(baseInput(), undefined, FAKE_DEPS);

    expect(mapMatchValhallaRouteMock).toHaveBeenCalledTimes(mapMatchCalls);
    expect(fetchValhallaRouteMock).toHaveBeenCalledTimes(routeCalls);
  });

  it("기본 경로 map-match가 모두 실패하면 후보별 무료 경로로 대체하지 않는다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [collected({ id: "A1" })] });
    mapMatchValhallaRouteMock.mockRejectedValue(new Error("baseline failed"));

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(fetchValhallaRouteMock).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "VALHALLA_UNAVAILABLE" }),
    );
  });
});

describe("search — STAGE 2 실제 우회 게이트", () => {
  it("선택 거리 밖의 후보는 제외하고, 다음에 시도할 거리를 알려준다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "TOO_LONG", location: wgs84(37.05, 127.15), price: 1500 })],
    });
    fetchValhallaRouteMock.mockResolvedValue({
      ...BASE_ROUTE,
      distanceM: BASE_ROUTE.distanceM + 5_000,
      durationS: BASE_ROUTE.durationS + 1_800,
    });

    const result = await search(baseInput({ maxDetourDistanceKm: 3 }), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates).toEqual([]);
    expect(result.distanceNeededForOneResultKm).toBe(5);
  });

  it("실측 NetSaving이 음수여도 실제로 갈 수 있는 우회 후보는 참고 후보로 남긴다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "EXPENSIVE", location: wgs84(37.05, 127.15), price: 2500 })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(fetchValhallaRouteMock).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].netSaving).toBeLessThan(0);
    expect(result.candidates[0].reason).toContain("손해입니다");
    expect(result.stage).toBe("DETOUR");
  });

  it("실측 우회거리와 안전 상한을 통과한 후보는 순절감액이 음수여도 남긴다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "ACTUAL_LOSS", location: wgs84(37.003, 127.15), price: 1890 })],
    });
    fetchValhallaRouteMock.mockResolvedValue({
      ...BASE_ROUTE,
      distanceM: BASE_ROUTE.distanceM + 5_000,
      durationS: BASE_ROUTE.durationS + 600,
    });

    const result = await search(baseInput({ maxDetourDistanceKm: 10 }), undefined, FAKE_DEPS);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].netSaving).toBeLessThan(0);
  });

  it("순절감액이 양수인 우회 후보를 손해 후보보다 먼저 보여준다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "CHEAP", price: 1700 }),
        collected({ id: "EXPENSIVE", price: 2500 }),
      ],
    });

    const result = await search(baseInput({ maxDetourDistanceKm: 10 }), undefined, FAKE_DEPS);

    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual([
      "CHEAP",
      "EXPENSIVE",
    ]);
    expect(result.candidates[0].netSaving).toBeGreaterThan(0);
    expect(result.candidates[1].netSaving).toBeLessThan(0);
  });

  it("기준가가 없으면 T2 표본만 가격순으로 반환한다", async () => {
    computeReferencePriceMock.mockResolvedValue(null);
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "CHEAP", price: 1500 }),
        collected({ id: "EXPENSIVE", price: 1800 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.referencePrice).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "NO_REFERENCE_PRICE" }));
    expect(result.candidates[0].station.id).toBe("CHEAP");
    expect(result.candidates.every((candidate) => candidate.dPerp <= T2_MAX)).toBe(true);
  });
});

describe("search — 기존 API·진행 계약", () => {
  it("기준일자·기본 경로 우선순위·필터를 유지한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [collected({ id: "A1" })] });

    const result = await search(baseInput({ avoidHighway: true }), undefined, FAKE_DEPS);

    expect(result.candidates[0].priceUpdatedAt).toEqual(new Date("2026-08-30T00:00:00Z"));
    expect(getRouteMock.mock.calls.map(([options]) => options.priority)).toEqual([
      "RECOMMEND",
      "TIME",
      "DISTANCE",
    ]);
    expect(getRouteMock.mock.calls.every(([options]) => options.avoidHighway === true)).toBe(true);
  });

  it("진행 콜백 유무와 무관하게 같은 결과를 반환한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.05, 127.15), price: 1500 })],
    });

    const withCallback = await search(baseInput(), () => {}, FAKE_DEPS);
    const withoutCallback = await search(baseInput(), undefined, FAKE_DEPS);
    const { searchId: searchIdA, ...a } = withCallback;
    const { searchId: searchIdB, ...b } = withoutCallback;
    void searchIdA;
    void searchIdB;

    expect(a).toEqual(b);
  });

  it("STAGE 2 진행 이벤트에서 partial을 유지한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.05, 127.15), price: 1500 })],
    });
    const events: ProgressEvent[] = [];

    await search(baseInput(), (event) => events.push(event), FAKE_DEPS);

    expect(events.filter((event) => event.type === "progress").map((event) => event.step)).toEqual([
      "ROUTE",
      "COLLECT",
      "EXPAND",
      "PRECISE",
    ]);
    expect(events.some((event) => event.type === "partial")).toBe(true);
  });

  it("취소된 신호면 외부 경로 조회를 시작하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      search(baseInput(), undefined, { ...FAKE_DEPS, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getRouteMock).not.toHaveBeenCalled();
  });

  it("결과를 반환하면서 익명 검색 로그를 호출한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [collected({ id: "A1" })] });

    await search(baseInput(), undefined, FAKE_DEPS);

    expect(logSearchMock).toHaveBeenCalledTimes(1);
    expect(logSearchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ routeCalls: 3 }));
  });
});
