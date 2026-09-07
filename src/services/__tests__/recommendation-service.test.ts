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
import { MAX_PRECISE, T2_MAX } from "@/domain/params";
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

describe("search — 경로 API 호출 예산 (ARCHITECTURE.md §5.3)", () => {
  // "카카오 경로 API는 검색당 항상 7회 이하 (기본 1 + 정밀 최대 MAX_PRECISE)".
  it("후보가 많아도 경로 API 호출은 1(기본) + MAX_PRECISE 이하다", async () => {
    collectStationsMock.mockResolvedValue({ stations: mixedCandidates() });

    await search(baseInput(), undefined, FAKE_DEPS);

    const total = getRouteMock.mock.calls.length;
    const base = getRouteMock.mock.calls.filter(([o]) => !o.waypoint).length;
    const precise = getRouteMock.mock.calls.filter(([o]) => o.waypoint).length;

    expect(base).toBe(1);
    expect(precise).toBeLessThanOrEqual(MAX_PRECISE);
    expect(total).toBeLessThanOrEqual(1 + MAX_PRECISE);
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
      .map((w) => `${w.lat},${w.lng}`);
    expect(new Set(waypoints).size).toBe(waypoints.length);
  });
});

describe("search — 정밀 계산 대상 선정 (STEP10)", () => {
  it("모드마다 다른 후보를 뽑아 합집합이 MAX_PRECISE까지 채워진다", async () => {
    const pool = mixedCandidates();
    collectStationsMock.mockResolvedValue({ stations: pool });

    await search(baseInput(), undefined, FAKE_DEPS);

    const ids = preciseStationIds(pool);
    expect(ids).toHaveLength(MAX_PRECISE);
    expect(ids.some((id) => id.startsWith("NEAR"))).toBe(true);
    expect(ids.some((id) => id.startsWith("FAR"))).toBe(true);
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

describe("search — T3 게이트 (STEP8)", () => {
  it("NetSaving>0인 T3 후보는 살아남고, expansion.triggered·finalRadiusM에 그 d_perp가 반영된다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }), // T1
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }), // T1
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1700 }), // T3, 저렴 → 게이트 통과
      ],
    });

    const events: ProgressEvent[] = [];
    const result = await search(baseInput(), (e) => events.push(e), FAKE_DEPS);

    const t3 = result.candidates.find((c) => c.station.id === "A3");
    expect(t3).toBeDefined();
    expect(t3!.tier).toBe("T3");
    expect(result.expansion.triggered).toBe(true); // T3가 최종 채택됨 → 배너 문구 유지
    expect(result.expansion.finalRadiusM).toBeGreaterThan(3_000);
    expect(result.expansion.finalRadiusM).toBe(t3!.dPerp);

    // 결과 화면 배너뿐 아니라, 로딩 화면에서도 "넓혀서 찾고 있다"는 안내가 떠야 한다
    // (T1+T2가 부족해서 별도로 확장 수집을 하던 옛 흐름은 없어졌지만, 최종 반경이
    // T2_MAX를 넘는다는 사실 자체는 정밀 계산 전에 이미 확정돼 있다).
    const expandEvent = events.find((e) => e.type === "progress" && e.step === "EXPAND");
    expect(expandEvent).toBeDefined();
    expect((expandEvent as { radiusM?: number }).radiusM).toBe(t3!.dPerp);
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
  });
});

describe("search — 실측 우회거리로 상위 후보 배지 재판정 (STEP10)", () => {
  it("d_perp는 0(경로상)이지만 실측 우회가 6km를 넘으면 배지가 '우회'로 바뀐다", async () => {
    // 기본 mock: 경유 경로 = 기본 + 6,800m (F×T2_MAX=6,000m 초과 → T3)
    collectStationsMock.mockResolvedValue({
      stations: [collected({ id: "A1", location: wgs84(37.0, 127.15) })], // 경로 위, d_perp ≈ 0
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const c = result.candidates.find((x) => x.station.id === "A1")!;
    expect(c.detour.precise).toBe(true);
    expect(c.tier).toBe("T3"); // 실측 우회 6.8km → 재판정
    // "어디까지 뒤졌나"는 기하 기준이라 그대로 — 배지만 바뀌고 배너는 켜지지 않는다
    expect(result.expansion.triggered).toBe(false);
    expect(result.expansion.finalRadiusM).toBe(T2_MAX);
  });

  it("d_perp는 5km대(T3)지만 실측 우회가 짧으면 배지가 '경로상'으로 바뀐다 — 배너는 기하 기준이라 유지", async () => {
    getRouteMock.mockImplementation(async (opts) => {
      if (opts.waypoint) {
        return { distanceM: BASE_ROUTE.distanceM + 200, durationS: BASE_ROUTE.durationS + 30, polyline: BASE_ROUTE.polyline };
      }
      return BASE_ROUTE;
    });
    collectStationsMock.mockResolvedValue({
      stations: [
        collected({ id: "A1", location: wgs84(37.0, 127.1) }), // T1
        collected({ id: "A2", location: wgs84(37.0, 127.2), price: 1750 }), // T1
        collected({ id: "A3", location: wgs84(37.05, 127.15), price: 1700 }), // T3, 저렴 → 게이트 통과
      ],
    });

    const result = await search(baseInput(), undefined, FAKE_DEPS);

    const c = result.candidates.find((x) => x.station.id === "A3")!;
    expect(c.detour.precise).toBe(true);
    expect(c.tier).toBe("T1"); // 실측 우회 200m → 재판정
    // geoTier는 여전히 T3라서 "넓혀서 찾았다" 배너는 그대로 켜진다
    expect(result.expansion.triggered).toBe(true);
    expect(result.expansion.finalRadiusM).toBe(c.dPerp);
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
