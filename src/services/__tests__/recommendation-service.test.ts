import { describe, expect, it, vi, beforeEach } from "vitest";

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
import { T2_MAX } from "@/domain/params";
import type { BaseRoute, RefuelPoint, SearchInput, Fuel } from "@/domain/types";
import type { RedisLike } from "../route-service";
import type { Db } from "@/infra/db/client";

const getRouteMock = vi.mocked(getRoute);
const collectStationsMock = vi.mocked(collectStations);
const computeReferencePriceMock = vi.mocked(computeReferencePrice);
const logSearchMock = vi.mocked(logSearch);

const FAKE_DEPS = { redis: {} as RedisLike, db: {} as Db, now: new Date("2026-08-31T03:00:00.000Z") };

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
    location: wgs84(37.0, 127.15), // 경로 위 (T1)
    facilities: { carWash: false, maintenance: false, cvs: false },
    isKpetro: false,
    ...overrides,
  };
}

/** collectStations가 돌려주는 {station, price, pricedOn} 튜플 — pricedOn 기본값 포함 */
function collected(
  overrides: Partial<RefuelPoint> & { price?: number; pricedOn?: string | null } = {},
) {
  const { price = 1700, pricedOn = "2026-08-30", ...stationOverrides } = overrides;
  return { station: station(stationOverrides), price, pricedOn };
}

const VEHICLE = { fuel: "GASOLINE" as Fuel, efficiencyKmPerL: 10, refuelAmountL: 45, timeValuePerMin: 200 };

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

/**
 * T1·T2·T3가 고루 섞이고 "가까움"과 "쌈"이 서로 반대 방향인 후보 묶음.
 * minDistance는 NEAR를, minCost·balanced는 FAR를 선호하므로 모드별 top3가 갈린다.
 */
function mixedCandidates() {
  return [
    // 경로 위(d_perp ≈ 0) · 비쌈 → minDistance가 선호
    ...Array.from({ length: 4 }, (_, i) =>
      collected({ id: `NEAR${i}`, location: wgs84(37.0, 127.02 + i * 0.03), price: 1890 - i }),
    ),
    // 멀리(d_perp ≈ 5.5km) · 매우 쌈 → minCost·balanced가 선호
    ...Array.from({ length: 4 }, (_, i) =>
      collected({ id: `FAR${i}`, location: wgs84(37.05, 127.04 + i * 0.03), price: 1600 - i }),
    ),
    // 중간(d_perp ≈ 2km) · 중간 가격
    ...Array.from({ length: 4 }, (_, i) =>
      collected({ id: `MID${i}`, location: wgs84(37.018, 127.06 + i * 0.03), price: 1750 - i }),
    ),
  ];
}

/**
 * MAX_PRECISE(15)보다 많은 후보 — STAGE 2 우회 예산과 "실측군 우선" 정렬을 검증할 때 쓴다.
 * NEAR는 경로 위(가깝지만 비쌈), FAR는 경로에서 벗어남(멀지만 쌈)이라 모드별 선호가 갈린다.
 */
function manyCandidates(n: number) {
  return Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? collected({ id: `NEAR${i}`, location: wgs84(37.0, 127.01 + i * 0.006), price: 1890 - i })
      : collected({ id: `FAR${i}`, location: wgs84(37.02, 127.01 + i * 0.006), price: 1700 - i }),
  );
}

/** getRoute가 실제로 경유지로 불러간 주유소 id */
function preciseStationIds(pool: Array<{ station: RefuelPoint }>): string[] {
  const waypoints = getRouteMock.mock.calls
    .map(([o]) => o.waypoint)
    .filter((w): w is NonNullable<typeof w> => w != null);
  return pool
    .filter((c) => waypoints.some((w) => w.lat === c.station.location.lat && w.lng === c.station.location.lng))
    .map((c) => c.station.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  logSearchMock.mockResolvedValue(undefined);
  getRouteMock.mockImplementation(async (opts) => {
    if (opts.waypoint) {
      return { distanceM: BASE_ROUTE.distanceM + 6_800, durationS: BASE_ROUTE.durationS + 400, polyline: BASE_ROUTE.polyline };
    }
    return BASE_ROUTE;
  });
  computeReferencePriceMock.mockResolvedValue({ price: 1900, source: "MEDIAN_T1T2" });
});

describe("search — 회랑 수집 (docs/MIGRATION-DB.md §7 Phase C)", () => {
  it("collectStations를 정확히 한 번만 호출한다 (확장 수집 없음)", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.1) })],
    });

    await search(baseInput(), undefined, FAKE_DEPS);

    expect(collectStationsMock).toHaveBeenCalledTimes(1);
    const opts = collectStationsMock.mock.calls[0][0];
    expect(opts.referencePoints.length).toBeGreaterThan(0);
    expect(opts.marginM).toBeGreaterThan(0);
  });

  it("후보가 적어도(T1+T2 1개뿐) 추가로 수집하지 않는다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.1) })],
    });

    const events: ProgressEvent[] = [];
    const result = await search(baseInput(), (e) => events.push(e), FAKE_DEPS);

    expect(collectStationsMock).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "progress" && e.step === "EXPAND")).toBe(false);
    expect(events.filter((e) => e.type === "progress").map((e) => e.step)).toEqual([
      "ROUTE", "COLLECT", "PRECISE",
    ]);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("각 후보의 priceUpdatedAt은 station-service가 돌려준 pricedOn(CSV 기준일자)이다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.1), pricedOn: "2026-08-29" })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);
    expect(result.candidates[0].priceUpdatedAt).toEqual(new Date("2026-08-29T00:00:00Z"));
  });

  it("pricedOn이 null이면(상세 API 전용 행) priceUpdatedAt도 undefined다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.1), pricedOn: null })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);
    expect(result.candidates[0].priceUpdatedAt).toBeUndefined();
  });
});

describe("search — 비교 경로 합치기", () => {
  it("세 기본 경로의 같은 주유소는 실제 경유 도착 시간이 가장 짧은 버전 하나만 남긴다", async () => {
    const routesByPriority: Record<"RECOMMEND" | "TIME" | "DISTANCE", BaseRoute> = {
      RECOMMEND: BASE_ROUTE,
      TIME: { ...BASE_ROUTE, distanceM: 27_000, durationS: 1_700, polyline: [wgs84(37.005, 127.0), wgs84(37.005, 127.3)] },
      DISTANCE: { ...BASE_ROUTE, distanceM: 25_900, durationS: 1_900, polyline: [wgs84(37.01, 127.0), wgs84(37.01, 127.3)] },
    };
    getRouteMock.mockImplementation(async (opts) => {
      const priority = opts.priority ?? "RECOMMEND";
      const base = routesByPriority[priority];
      if (!opts.waypoint) return base;
      const extra = priority === "TIME" ? 60 : priority === "RECOMMEND" ? 170 : 150;
      return { ...base, distanceM: base.distanceM + 300, durationS: base.durationS + extra };
    });
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "SAME", location: wgs84(37.0, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.baseRoutes).toHaveLength(3);
    expect(collectStationsMock).toHaveBeenCalledTimes(3);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].routePriority).toBe("TIME");
  });

  it("도형이 같은 기본 경로는 한 번만 회랑을 수집한다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) return { ...BASE_ROUTE, distanceM: BASE_ROUTE.distanceM + 300, durationS: BASE_ROUTE.durationS + 60 };
      if (opts.priority === "DISTANCE") {
        return { ...BASE_ROUTE, polyline: [wgs84(37.01, 127.0), wgs84(37.01, 127.3)] };
      }
      return BASE_ROUTE;
    });
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.15) })],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.baseRoutes).toHaveLength(2);
    expect(collectStationsMock).toHaveBeenCalledTimes(2);
  });
});

describe("search — 경로 API 호출 예산 (ARCHITECTURE.md §5.3)", () => {
  it("T3 회랑 후보는 모두 실측하고, 우회 후보만 MAX_PRECISE 상한을 따른다", async () => {
    const pool = manyCandidates(40);
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput(), undefined, FAKE_DEPS);

    const total = getRouteMock.mock.calls.length;
    const base = getRouteMock.mock.calls.filter(([o]) => !o.waypoint).length;
    const precise = getRouteMock.mock.calls.filter(([o]) => o.waypoint).length;

    expect(base).toBe(3);
    expect(precise).toBe(pool.length);
    expect(total).toBe(3 + pool.length);
  });

  it("정밀 계산 대상은 서로 다른 경유지를 쓴다 (같은 주유소를 중복 계산하지 않는다)", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      collected({ id: `B${i}`, location: wgs84(37.0, 127.02 + i * 0.02), price: 1700 + i }),
    );
    collectStationsMock.mockResolvedValue({ stations: many });

    await search(baseInput(), undefined, FAKE_DEPS);

    const waypoints = getRouteMock.mock.calls
      .map(([o]) => o.waypoint)
      .filter((w): w is NonNullable<typeof w> => w != null)
      .map((w, index) => `${w.lat},${w.lng}:${getRouteMock.mock.calls.filter(([o]) => o.waypoint != null)[index][0].priority}`);
    expect(new Set(waypoints).size).toBe(waypoints.length);
  });
});

describe("search — 정밀 계산 대상 선정 (STEP10)", () => {
  it("후보가 MAX_PRECISE 이하면 전부 실측한다", async () => {
    const pool = mixedCandidates(); // 12개
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput(), undefined, FAKE_DEPS);

    const ids = preciseStationIds(pool);
    expect(ids).toHaveLength(pool.length);
    expect(ids.some((id) => id.startsWith("NEAR"))).toBe(true);
    expect(ids.some((id) => id.startsWith("FAR"))).toBe(true);
  });

  it("STAGE 1은 회랑 안의 후보를 전부 실측하고 STAGE 2만 MAX_PRECISE로 제한한다", async () => {
    const pool = manyCandidates(40);
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput({ includeDetour: true }), undefined, FAKE_DEPS);

    const measured = preciseStationIds(pool).length;
    expect(measured).toBe(pool.length);
  });

  // STAGE 1이 3배치를 다 쓰고도 경로상을 못 찾으면 STAGE 2로 넘어간다. 그때 이미 잰
  // 후보를 다시 재면 예산이 두 배로 드므로, 실측값을 병합해 재측정을 건너뛴다.
  it("STAGE 1 → STAGE 2 폴백에서 같은 주유소를 두 번 재지 않는다", async () => {
    const pool = manyCandidates(40);
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput(), undefined, FAKE_DEPS);

    const waypointCalls = getRouteMock.mock.calls.filter(([o]) => o.waypoint != null);
    const uniqueWaypoints = new Set(waypointCalls.map(([o]) => `${o.waypoint!.lat},${o.waypoint!.lng}:${o.priority}`));
    expect(waypointCalls).toHaveLength(uniqueWaypoints.size);
  });

  it("A8 — 실패한 경유 경로는 추정치로 유지하고 재호출하지 않는다", async () => {
    const failed = collected({
      id: "FAILED",
      location: wgs84(37.05, 127.15),
      price: 1600,
    });
    collectStationsMock.mockResolvedValue({ stations: [failed] });
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) throw new Error("경유 경로 실패");
      return BASE_ROUTE;
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);
    const waypointCalls = getRouteMock.mock.calls.filter(
      ([opts]) => opts.waypoint != null,
    );

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].detour.precise).toBe(false);
    expect(waypointCalls).toHaveLength(1);
  });

  it("모드마다 다른 후보를 뽑아 합집합을 만든다 — 탭을 바꿔도 실측된 후보가 있다", async () => {
    const pool = manyCandidates(40);
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput(), undefined, FAKE_DEPS);
    const ids = preciseStationIds(pool);

    // minDistance가 선호하는 "가깝지만 비싼" 후보와 balanced·minCost가 선호하는
    // "싸지만 먼" 후보가 모두 실측 대상에 들어가야 한다.
    expect(ids.some((id) => id.startsWith("NEAR"))).toBe(true);
    expect(ids.some((id) => id.startsWith("FAR"))).toBe(true);
  });

  // 이 테스트가 이번 개선의 핵심이다. 실측은 추정보다 우회를 크게 잡는 쪽으로만
  // 움직이므로, 실측군과 추정군을 같은 표에서 정렬하면 실측된 후보가 반드시 진다.
  it("실측된 후보가 추정치 후보보다 항상 위에 온다", async () => {
    const pool = manyCandidates(40);
    collectStationsMock.mockResolvedValue({ stations: pool });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const firstEstimated = result.candidates.findIndex((c) => !c.detour.precise);
    const lastPrecise = result.candidates.map((c) => c.detour.precise).lastIndexOf(true);
    if (firstEstimated !== -1) expect(firstEstimated).toBeGreaterThan(lastPrecise);
  });

  it("화면에 올라가는 후보는 전부 실측값을 쓴다 (MAX_PRECISE === MAX_RESULTS)", async () => {
    collectStationsMock.mockResolvedValue({ stations: manyCandidates(40) });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(c.detour.precise).toBe(true);
  });

  // partial → result에서 목록이 통째로 바뀌면 로딩 중 보던 카드가 전부 사라진다.
  it("partial과 result의 구성원이 같다 — 순위·수치만 갱신된다", async () => {
    collectStationsMock.mockResolvedValue({ stations: manyCandidates(40) });

    const events: ProgressEvent[] = [];
    const result = await search(baseInput(), (e) => events.push(e), FAKE_DEPS);

    const partial = events.find((e) => e.type === "partial");
    expect(partial).toBeDefined();
    const partialIds = new Set(
      (partial as Extract<ProgressEvent, { type: "partial" }>).data.candidates.map((c) => c.station.id),
    );
    expect((partial as Extract<ProgressEvent, { type: "partial" }>).data.baseRoutes).toEqual(result.baseRoutes);
    for (const c of result.candidates) expect(partialIds.has(c.station.id)).toBe(true);
  });

  it("A8 — 경유 경로가 실패해도 다른 경로상 후보 목록은 유지한다", async () => {
    const pool = mixedCandidates();
    collectStationsMock.mockResolvedValue({ stations: pool });
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return BASE_ROUTE;
      if (opts.waypoint.lat === 37.05) throw new Error("경유 경로 실패");
      return { distanceM: BASE_ROUTE.distanceM + 1_000, durationS: BASE_ROUTE.durationS + 120, polyline: BASE_ROUTE.polyline };
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.every((candidate) => candidate.detour.precise)).toBe(true);
  });

  it("최종 목록 상위 후보는 추정치가 아니라 정밀 계산값을 쓴다", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    for (const c of result.candidates.slice(0, 3)) {
      expect(c.detour.precise).toBe(true);
    }
  });

  it("minCost 모드에서도 1위 후보가 정밀 계산된다 (선정 순위와 표시 순위가 어긋나지 않는다)", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    const result = await search(baseInput({ mode: "minCost" }), undefined, FAKE_DEPS);

    expect(result.candidates[0].detour.precise).toBe(true);
  });
});

describe("search — avoidHighway (고속도로·자동차전용도로 회피)", () => {
  it("기본 경로·정밀 계산 양쪽 모두에 avoidHighway를 그대로 전달한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    await search(baseInput({ avoidHighway: true }), undefined, FAKE_DEPS);

    for (const [opts] of getRouteMock.mock.calls) {
      expect(opts.avoidHighway).toBe(true);
    }
  });

  it("avoidHighway: false면 모든 getRoute 호출에 false를 전달한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    await search(baseInput({ avoidHighway: false }), undefined, FAKE_DEPS);

    for (const [opts] of getRouteMock.mock.calls) {
      expect(opts.avoidHighway).toBe(false);
    }
  });
});

describe("search — 통행료 정보 표시 (2026-09-08, netSaving엔 미반영)", () => {
  it("경유 경로가 기본 경로보다 통행료가 비싸면 그 차액을 detour.tollWon으로 준다", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return { ...BASE_ROUTE, tollWon: 1_000 };
      return { distanceM: BASE_ROUTE.distanceM + 1_000, durationS: BASE_ROUTE.durationS + 120, tollWon: 3_900, polyline: BASE_ROUTE.polyline };
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    for (const c of result.candidates.filter((c) => c.detour.precise)) {
      expect(c.detour.tollWon).toBe(2_900); // 3,900 - 1,000
    }
  });

  it("경유 경로가 기본 경로보다 통행료가 싸거나 같으면 0으로 clamp한다 (음수 미표시)", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return { ...BASE_ROUTE, tollWon: 5_900 };
      return { distanceM: BASE_ROUTE.distanceM + 1_000, durationS: BASE_ROUTE.durationS + 120, tollWon: 0, polyline: BASE_ROUTE.polyline };
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    for (const c of result.candidates.filter((c) => c.detour.precise)) {
      expect(c.detour.tollWon).toBe(0);
    }
  });

  it("fare 정보가 없으면(구버전 캐시 등) tollWon은 undefined다 — 0원으로 단정하지 않는다", async () => {
    // beforeEach 기본 mock은 tollWon을 아예 안 준다.
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    for (const c of result.candidates.filter((c) => c.detour.precise)) {
      expect(c.detour.tollWon).toBeUndefined();
    }
  });
});

describe("search — 우회 게이트 (STEP7)", () => {
  it("NetSaving>0인 T3 후보는 살아남고, expansion.triggered·finalRadiusM에 그 d_perp가 반영된다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }), // T1
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }), // T1
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1550 }), // T3, 저렴 → 게이트·T1우선필터 통과
      ],
    });

    const events: ProgressEvent[] = [];
    const result = await search(baseInput(), (e) => events.push(e), FAKE_DEPS);

    const t3 = result.candidates.find((c) => c.station.id === "A3");
    expect(t3).toBeDefined();
    expect(t3!.tier).toBe("DETOUR");
    expect(result.expansion.triggered).toBe(true); // T3가 최종 채택됨 → 배너 문구 유지
    expect(result.expansion.finalRadiusM).toBeGreaterThan(3_000);
    expect(result.expansion.finalRadiusM).toBe(t3!.dPerp);

    // 결과 화면 배너뿐 아니라, 로딩 화면에서도 "넓혀서 찾고 있다"는 안내가 떠야 한다
    // (T1+T2가 부족해서 별도로 확장 수집을 하던 옛 흐름은 없어졌지만, 최종 반경이
    // T2_MAX를 넘는다는 사실 자체는 정밀 계산 전에 이미 확정돼 있다).
    const expandEvent = events.find((e) => e.type === "progress" && e.step === "EXPAND");
    expect(expandEvent).toBeDefined();
    expect((expandEvent as { radiusM?: number }).radiusM).toBe(t3!.dPerp);
    expect(events.filter((e) => e.type === "progress").map((e) => e.step)).toEqual([
      "ROUTE", "COLLECT", "EXPAND", "PRECISE",
    ]);
  });

  it("NetSaving<=0인 T3 후보는 목록에서 제외되고 expansion.triggered는 false다 — 로딩 중 EXPAND도 뜨지 않는다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }),
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }),
        // T3인데 오히려 더 비쌈 → 우회할 이유가 없어 게이트 탈락
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 2500 }),
      ],
    });

    const events: ProgressEvent[] = [];
    const result = await search(baseInput(), (e) => events.push(e), FAKE_DEPS);

    expect(result.candidates.find((c) => c.station.id === "A3")).toBeUndefined();
    expect(result.expansion.triggered).toBe(false);
    expect(result.expansion.finalRadiusM).toBe(T2_MAX); // 채택된 T3 없음 → T2_MAX 폴백
    expect(events.some((e) => e.type === "progress" && e.step === "EXPAND")).toBe(false);
    expect(events.filter((e) => e.type === "progress").map((e) => e.step)).toEqual([
      "ROUTE", "COLLECT", "PRECISE",
    ]);
  });
});

describe("search — STAGE 1 경로상 우선 (PRODUCT.md §6.6, 불변식 8)", () => {
  it("경로상(ΔT ≤ 3분)이 하나라도 있으면 그것만 보여주고 우회는 아예 안 담는다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return BASE_ROUTE;
      // 경로 위 후보는 1분, 멀리 있는 후보는 12분
      const onRoute = opts.waypoint.lat === 37.0;
      return {
        distanceM: BASE_ROUTE.distanceM + (onRoute ? 300 : 9_000),
        durationS: BASE_ROUTE.durationS + (onRoute ? 60 : 720),
        polyline: BASE_ROUTE.polyline,
      };
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "ONROUTE", location: wgs84(37.0, 127.1), price: 1800 }),
        collected({ id: "FAR", location: wgs84(37.05, 127.15), price: 1500 }), // 훨씬 싸지만 우회
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((c) => c.station.id)).toEqual(["ONROUTE"]);
    // 우회를 하나도 안 했으므로 고지 배너도 뜨지 않는다 (§5.3 ②)
    expect(result.expansion.triggered).toBe(false);
  });

  it("경로상이 0곳이면 STAGE 2로 넘어간다 (A16)", async () => {
    // 기본 mock은 모든 경유 경로가 +400s(6.7분) — 3분 게이트를 아무도 못 넘는다
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1), price: 1800 }),
        collected({ id: "A2", location: wgs84(37.05, 127.15), price: 1500 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("DETOUR");
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("includeDetour=true여도 경로상이 있으면 STAGE 2를 돌리지 않는다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return BASE_ROUTE;
      return { distanceM: BASE_ROUTE.distanceM + 300, durationS: BASE_ROUTE.durationS + 60, polyline: BASE_ROUTE.polyline };
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1), price: 1800 }),
        collected({ id: "A2", location: wgs84(37.05, 127.15), price: 1500 }),
      ],
    });

    const result = await search(baseInput({ includeDetour: true }), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.map((c) => c.station.id)).toEqual(expect.arrayContaining(["A1", "A2"]));
  });

  it("STAGE 1은 가격과 무관하게 T3 회랑 안의 후보를 전부 실측한다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return BASE_ROUTE;
      return { distanceM: BASE_ROUTE.distanceM + 300, durationS: BASE_ROUTE.durationS + 60, polyline: BASE_ROUTE.polyline };
    });
    // 전부 경로 위인 T3 회랑 후보 20곳. S0는 기준가보다 비싸고 S19가 최저가다.
    const pool = Array.from({ length: 20 }, (_, i) =>
      collected({ id: `S${i}`, location: wgs84(37.0, 127.01 + i * 0.001), price: i === 0 ? 2500 : 1900 - i }),
    );
    collectStationsMock.mockResolvedValue({ stations: pool });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    const waypointCalls = getRouteMock.mock.calls.filter(([o]) => o.waypoint != null);
    expect(waypointCalls).toHaveLength(pool.length);
    const measuredIds = new Set(preciseStationIds(pool));
    expect(measuredIds.size).toBe(pool.length);
    expect(measuredIds.has("S19")).toBe(true);
    expect(measuredIds.has("S0")).toBe(true);
    expect(result.candidates).toHaveLength(pool.length);
  });

  it("경로상 후보가 있으면 우회 탐색 요청도 경로상 목록에서 끝낸다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (!opts.waypoint) return BASE_ROUTE;
      const isDetour = opts.waypoint.lat === 37.05;
      return {
        distanceM: BASE_ROUTE.distanceM + (isDetour ? 9_000 : 300),
        durationS: BASE_ROUTE.durationS + (isDetour ? 720 : 60),
        polyline: BASE_ROUTE.polyline,
      };
    });
    const onRoutePool = Array.from({ length: 20 }, (_, i) =>
      collected({ id: `ON${i}`, location: wgs84(37.0, 127.01 + i * 0.001), price: 1900 - i }),
    );
    collectStationsMock.mockResolvedValue({
      stations: [
        ...onRoutePool,
        collected({ id: "DETOUR", location: wgs84(37.05, 127.15), price: 1500 }),
      ],
    });

    const result = await search(baseInput({ includeDetour: true }), undefined, FAKE_DEPS);

    expect(result.stage).toBe("ON_ROUTE");
    expect(result.candidates.filter((candidate) => candidate.tier === "ON_ROUTE")).toHaveLength(20);
    expect(result.candidates.find((candidate) => candidate.station.id === "DETOUR")).toBeUndefined();
  });
});

describe("search — 배지는 실측 ΔT로만 판정한다 (불변식 6)", () => {
  it("d_perp가 0이어도 실측 ΔT가 3분을 넘으면 '우회'다 — U턴 7분짜리를 경로상이라 부르지 않는다", async () => {
    // 기본 mock: 경유 경로 = 기본 + 400s(6.7분)
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.15) }), // 경로 위, d_perp ≈ 0
        collected({ id: "A2", location: wgs84(37.0, 127.1), price: 1700 }),
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const c = result.candidates.find((x) => x.station.id === "A1")!;
    expect(c.detour.precise).toBe(true);
    expect(c.dPerp).toBeLessThan(500); // 기하적으로는 경로에 붙어 있는데
    expect(c.tier).toBe("DETOUR"); // 실측 6.7분이라 우회다
  });

  it("d_perp가 5km대여도 STAGE 1에서 실측해 '경로상'으로 보여준다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) {
        return { distanceM: BASE_ROUTE.distanceM + 200, durationS: BASE_ROUTE.durationS + 30, polyline: BASE_ROUTE.polyline };
      }
      return BASE_ROUTE;
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }),
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1550 }), // d_perp 5km대
      ],
    });

    // A3는 과거의 2.5km 사전 필터 밖이지만 T3 회랑 안이므로 STAGE 1에서 실측한다.
    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const c = result.candidates.find((x) => x.station.id === "A3")!;
    expect(c.detour.precise).toBe(true);
    expect(c.dPerp).toBeGreaterThan(3_000);
    expect(c.tier).toBe("ON_ROUTE"); // 배지는 실측 ΔT(30초)만 본다
    expect(result.stage).toBe("ON_ROUTE");
    expect(result.expansion.triggered).toBe(false);
    expect(result.expansion.finalRadiusM).toBe(T2_MAX);
  });
});

describe("search — 짧은 경로에서도 우회 후보를 보여준다 (사용자 실측: 남한산성입구역→을지대학교)", () => {
  it("기본 경로가 MIN_ROUTE_DISTANCE 미만이면 우회가 D_base×50%를 넘어도 후보를 제외하지 않는다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) {
        return { distanceM: 12_000, durationS: 900, polyline: BASE_ROUTE.polyline }; // 우회 10,000m
      }
      return { distanceM: 2_000, durationS: 300, polyline: BASE_ROUTE.polyline };
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }), // T1
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }), // T1
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1500 }), // T3, 저렴 → 게이트 통과
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const t3 = result.candidates.find((c) => c.station.id === "A3");
    expect(t3).toBeDefined();
    expect(t3!.detour.distanceM).toBe(10_000); // 50% cap(1,000m)을 훨씬 넘지만 살아있어야 함
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "SHORT_ROUTE" }));
  });

  // Phase 11 실측 — 바로 위 테스트가 처음 이 예외를 만들게 한 그 경로인데, 오늘
  // 실측하면 8분짜리 기본 경로에 54분 우회가 순절감액>0(추정 기준)이라는 이유만으로
  // 그대로 남아 있었다. "비율 cap을 끄면 무한정 찾아주지 않는다"는 원래 근거가
  // 틀렸다는 뜻 — 절대 시간 상한(SHORT_ROUTE_DETOUR_TIME_CAP_S, 20분)으로 막는다.
  it("짧은 경로여도 우회 시간이 SHORT_ROUTE_DETOUR_TIME_CAP_S(20분)를 넘으면 제외한다", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) {
        return { distanceM: 40_000, durationS: 3_780, polyline: BASE_ROUTE.polyline }; // 우회 54분
      }
      return { distanceM: 2_000, durationS: 300, polyline: BASE_ROUTE.polyline };
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }), // T1
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }), // T1
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1500 }), // T3, 저렴 → 추정 게이트는 통과
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    expect(result.candidates.find((c) => c.station.id === "A3")).toBeUndefined();
  });
});

describe("search — onProgress 유무와 무관하게 동일한 결과", () => {
  it("콜백을 넘기지 않아도 같은 SearchResult(가 searchId 제외)를 반환한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }),
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }),
        collected({ id: "A3", location: wgs84(37.0, 127.25), price: 1800 }),
      ],
    });

    const withCallback = await search(baseInput(), () => {}, FAKE_DEPS);
    const withoutCallback = await search(baseInput(), undefined, FAKE_DEPS);

    const { searchId: searchIdA, ...a } = withCallback;
    const { searchId: searchIdB, ...b } = withoutCallback;
    void searchIdA;
    void searchIdB;
    expect(a).toEqual(b);
  });
});

describe("search — event-service 호출 (fire-and-forget 스텁)", () => {
  it("결과를 반환하면서 logSearch를 호출한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }),
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }),
        collected({ id: "A3", location: wgs84(37.0, 127.25), price: 1800 }),
      ],
    });

    await search(baseInput(), undefined, FAKE_DEPS);
    expect(logSearchMock).toHaveBeenCalledTimes(1);
  });
});
