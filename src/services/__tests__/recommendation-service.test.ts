import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../route-service", () => ({ getRoute: vi.fn() }));
vi.mock("../station-service", () => ({ collectStations: vi.fn() }));
vi.mock("../price-service", () => ({ computeReferencePrice: vi.fn() }));
vi.mock("../event-service", () => ({ logSearch: vi.fn().mockResolvedValue(undefined) }));

import { search, type ProgressEvent } from "../recommendation-service";
import { getRoute } from "../route-service";
import { collectStations } from "../station-service";
import { computeReferencePrice } from "../price-service";
import { logSearch } from "../event-service";
import { wgs84 } from "@/domain/types";
import { ON_ROUTE_CORRIDOR_MAX_M, T2_MAX } from "@/domain/params";
import type { BaseRoute, Fuel, RefuelPoint, SearchInput } from "@/domain/types";
import type { RedisLike } from "../route-service";
import type { Db } from "@/infra/db/client";

const getRouteMock = vi.mocked(getRoute);
const collectStationsMock = vi.mocked(collectStations);
const computeReferencePriceMock = vi.mocked(computeReferencePrice);
const logSearchMock = vi.mocked(logSearch);

const findRoadLinkProbesMock = vi.fn();
const FAKE_DEPS = {
  redis: {} as RedisLike,
  db: {} as Db,
  now: new Date("2026-08-31T03:00:00.000Z"),
  findNearestRoadLinkProbes: findRoadLinkProbesMock,
};

// 동서 방향 약 26.4km 직선 — MIN_ROUTE_DISTANCE(20km) 초과
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

function setRoadProbes(stationIds: string[], headingRad = Math.PI / 2): void {
  findRoadLinkProbesMock.mockImplementation(async (points) =>
    points
      .filter((point: { stationId: string }) => stationIds.includes(point.stationId))
      .map((point: { stationId: string }) => ({
        stationId: point.stationId,
        distanceM: 25,
        headingRad,
      })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findRoadLinkProbesMock.mockResolvedValue([]);
  logSearchMock.mockResolvedValue(undefined);
  getRouteMock.mockResolvedValue(BASE_ROUTE);
  computeReferencePriceMock.mockResolvedValue({ price: 1900, source: "MEDIAN_T1T2" });
});

describe("search — 후보별 경유 경로 호출 제거", () => {
  it("기본 경로 3개만 조회하고 후보별 waypoint 호출은 하지 않는다", async () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      collected({
        id: `S${i}`,
        location: wgs84(i % 2 === 0 ? 37.0 : 37.02, 127.01 + i * 0.01),
        price: 1600 + i,
      }),
    );
    collectStationsMock.mockResolvedValue({ stations: pool });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(getRouteMock).toHaveBeenCalledTimes(3);
    expect(getRouteMock.mock.calls.every(([options]) => options.waypoint == null)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.detour.precise === false)).toBe(true);
    expect(findRoadLinkProbesMock).toHaveBeenCalledTimes(1);
  });

  it("검색 중 후보별 경유 API를 호출하지 않아도 추정 우회 후보를 반환한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "T3", location: wgs84(37.05, 127.15), price: 1500 })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].station.id).toBe("T3");
    expect(result.candidates[0].detour.precise).toBe(false);
    expect(result.candidates[0].detour.distanceM).toBeGreaterThan(0);
    expect(getRouteMock.mock.calls.filter(([options]) => options.waypoint != null)).toHaveLength(0);
  });
});

describe("search — 표준 링크 방향 필터", () => {
  it("경로 진행 방향과 호환되는 링크 후보를 경로상으로 보존한다", async () => {
    setRoadProbes(["SAME"]);
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "SAME", location: wgs84(37.0, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["SAME"]);
    expect(result.candidates[0].tier).toBe("ON_ROUTE");
    expect(result.candidates[0].detour.precise).toBe(false);
  });

  it("명백히 반대 방향인 링크 후보를 제외한다", async () => {
    findRoadLinkProbesMock.mockImplementation(async (points) =>
      points.map((point: { stationId: string }) => ({
        stationId: point.stationId,
        distanceM: 25,
        headingRad: point.stationId === "OPPOSITE" ? -Math.PI / 2 : Math.PI / 2,
      })),
    );
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "SAME", location: wgs84(37.0, 127.1) }),
        collected({ id: "OPPOSITE", location: wgs84(37.0, 127.2), price: 1400 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["SAME"]);
  });

  it("링크를 못 찾은 후보는 UNKNOWN으로 보존하고, 같은 방향 후보가 없을 때만 우회로 구성한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "UNKNOWN", location: wgs84(37.0, 127.15), price: 1500 })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["UNKNOWN"]);
    expect(result.candidates[0].tier).toBe("DETOUR");
  });

  it("T3에 같은 방향 링크가 있어도 T1/T2가 아니면 우회 후보로 남긴다", async () => {
    setRoadProbes(["T3"]);
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "T3", location: wgs84(37.05, 127.15), price: 1500 })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates[0].tier).toBe("DETOUR");
    expect(result.candidates[0].detour.precise).toBe(false);
  });

  it("같은 방향 링크여도 폴리라인에서 300m를 넘으면 우회 후보로 남긴다", async () => {
    setRoadProbes(["NEAR_OUTSIDE"]);
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "NEAR_OUTSIDE", location: wgs84(37.003, 127.15), price: 1500 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates[0].tier).toBe("DETOUR");
    expect(result.candidates[0].dPerp).toBeGreaterThan(ON_ROUTE_CORRIDOR_MAX_M);
  });
});

describe("search — 경로상 우선", () => {
  it("같은 방향 T1/T2 후보가 하나라도 있으면 T3 후보를 실행·표시하지 않는다", async () => {
    setRoadProbes(["ON_ROUTE"]);
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "ON_ROUTE", location: wgs84(37.0, 127.1), price: 1800 }),
        collected({ id: "T3", location: wgs84(37.05, 127.15), price: 1400 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["ON_ROUTE"]);
    expect(result.expansion.triggered).toBe(false);
    expect(getRouteMock.mock.calls.every(([options]) => options.waypoint == null)).toBe(true);
  });

  it("같은 방향 후보가 없으면 T3 후보를 기존 추정 게이트와 예산으로 구성한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "CHEAP", location: wgs84(37.05, 127.15), price: 1500 }),
        collected({ id: "EXPENSIVE", location: wgs84(37.05, 127.2), price: 2500 }),
      ],
    });

    const result = await search(baseInput({ maxDetourMinutes: 20 }), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates.map((candidate) => candidate.station.id)).toEqual(["CHEAP"]);
    expect(result.candidates[0].detour.precise).toBe(false);
    expect(result.expansion.finalRadiusM).toBeGreaterThan(T2_MAX);
  });

  it("후보가 서로 다른 기본 경로에 중복돼도 주유소는 한 번만 표시한다", async () => {
    getRouteMock.mockImplementation(async (options) =>
      options.priority === "DISTANCE"
        ? { ...BASE_ROUTE, polyline: [wgs84(37.01, 127.0), wgs84(37.01, 127.3)] }
        : BASE_ROUTE,
    );
    setRoadProbes(["SAME"]);
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "SAME", location: wgs84(37.0, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.baseRoutes).toHaveLength(2);
    expect(collectStationsMock).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
  });
});

describe("search — 기존 가격·필터·기준일 계약", () => {
  it("station-service가 반환한 가격 기준일을 유지한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", pricedOn: "2026-08-29" })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.candidates[0].priceUpdatedAt).toEqual(new Date("2026-08-29T00:00:00Z"));
  });

  it("avoidHighway와 기본 경로 우선순위 3개 계약을 유지한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [collected({ id: "A1" })] });

    await search(baseInput({ avoidHighway: true }), undefined, FAKE_DEPS);

    expect(getRouteMock).toHaveBeenCalledTimes(3);
    expect(getRouteMock.mock.calls.every(([options]) => options.avoidHighway === true)).toBe(true);
    expect(getRouteMock.mock.calls.map(([options]) => options.priority)).toEqual([
      "RECOMMEND",
      "TIME",
      "DISTANCE",
    ]);
  });

  it("기준가가 없으면 가격순 정렬 경고를 유지한다", async () => {
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
  });
});

describe("search — 취소·진행·로그 계약", () => {
  it("이미 중단된 신호면 외부 경로 조회를 시작하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      search(baseInput(), undefined, { ...FAKE_DEPS, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getRouteMock).not.toHaveBeenCalled();
  });

  it("onProgress 유무와 무관하게 같은 결과를 반환한다", async () => {
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

  it("detour 단계는 기존 progress/partial 이벤트를 유지한다", async () => {
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

  it("결과를 반환하면서 익명 검색 로그를 호출한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [collected({ id: "A1" })] });

    await search(baseInput(), undefined, FAKE_DEPS);

    expect(logSearchMock).toHaveBeenCalledTimes(1);
    expect(logSearchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ routeCalls: 3 }));
  });
});
