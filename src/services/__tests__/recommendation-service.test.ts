import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../route-service", () => ({ getRoute: vi.fn() }));
vi.mock("../station-service", () => ({ collectStations: vi.fn() }));
vi.mock("../price-service", () => ({ computeReferencePrice: vi.fn() }));
vi.mock("../event-service", () => ({ logSearch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/infra/valhalla/client", () => ({
  fetchValhallaRoute: vi.fn(),
  mapMatchValhallaRoute: vi.fn(),
}));

import { search, type ProgressEvent } from "../recommendation-service";
import { getRoute } from "../route-service";
import { collectStations } from "../station-service";
import { computeReferencePrice } from "../price-service";
import { logSearch } from "../event-service";
import {
  fetchValhallaRoute,
  mapMatchValhallaRoute,
} from "@/infra/valhalla/client";
import { T2_MAX } from "@/domain/params";
import { wgs84 } from "@/domain/types";
import type { BaseRoute, Fuel, RefuelPoint, SearchInput } from "@/domain/types";
import type { RedisLike } from "../route-service";
import type { Db } from "@/infra/db/client";

const getRouteMock = vi.mocked(getRoute);
const collectStationsMock = vi.mocked(collectStations);
const computeReferencePriceMock = vi.mocked(computeReferencePrice);
const logSearchMock = vi.mocked(logSearch);
const fetchValhallaRouteMock = vi.mocked(fetchValhallaRoute);
const mapMatchValhallaRouteMock = vi.mocked(mapMatchValhallaRoute);

const FAKE_DEPS = {
  redis: {} as RedisLike,
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

  it("후보별 Valhalla 실패가 있어도 성공한 후보는 보존한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "OK", location: wgs84(37.0, 127.1) }),
        collected({ id: "FAILED", location: wgs84(37.003, 127.2) }),
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
  it("추정 게이트를 통과한 후보는 실제 우회값으로 예산을 다시 확인한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "TOO_LONG", location: wgs84(37.05, 127.15), price: 1500 })],
    });
    fetchValhallaRouteMock.mockResolvedValue({
      ...BASE_ROUTE,
      distanceM: BASE_ROUTE.distanceM + 5_000,
      durationS: BASE_ROUTE.durationS + 1_800,
    });

    const result = await search(baseInput({ maxDetourMinutes: 20 }), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates).toEqual([]);
    expect(result.minutesNeededForOneResult).toBe(30);
  });

  it("우회 후보는 추정 NetSaving 게이트에서 탈락하면 최종 목록에 넣지 않는다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "EXPENSIVE", location: wgs84(37.05, 127.15), price: 2500 })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(fetchValhallaRouteMock).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([]);
    expect(result.stage).toBe("DETOUR");
  });

  it("실제 NetSaving이 음수로 뒤집혀도 추정 게이트를 통과한 후보는 제거하지 않는다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "ACTUAL_LOSS", location: wgs84(37.003, 127.15), price: 1890 })],
    });
    fetchValhallaRouteMock.mockResolvedValue({
      ...BASE_ROUTE,
      distanceM: BASE_ROUTE.distanceM + 5_000,
      durationS: BASE_ROUTE.durationS + 600,
    });

    const result = await search(baseInput({ maxDetourMinutes: 20 }), undefined, FAKE_DEPS);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].station.id).toBe("ACTUAL_LOSS");
    expect(result.candidates[0].netSaving).toBeLessThan(0);
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
      "PRECISE",
      "EXPAND",
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
