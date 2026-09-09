import { describe, expect, it } from "vitest";
import {
  classifyByDetour,
  isOutOfRange,
  isOnRouteCandidate,
  routeAvgSpeedKmh,
  estimateDetourDurationSAtSpeed,
} from "../tier";
import {
  T3_MAX,
  ON_ROUTE_MAX_S,
  ON_ROUTE_MAX_D,
  ON_ROUTE_PREFILTER_M,
  ROUTE_SPEED_MIN_KMH,
  ROUTE_SPEED_MAX_KMH,
} from "../params";

describe("classifyByDetour — 배지는 실측 ΔT·ΔD 둘 다로 판정한다 (불변식 6)", () => {
  it("ΔT·ΔD 둘 다 작으면 ON_ROUTE", () =>
    expect(classifyByDetour(0, 0)).toBe("ON_ROUTE"));
  it("경계값 두 개 다 딱 맞으면 ON_ROUTE", () =>
    expect(classifyByDetour(ON_ROUTE_MAX_S, ON_ROUTE_MAX_D)).toBe("ON_ROUTE"));

  it("ΔT가 크면 DETOUR — 경로 117m 옆인데 U턴 7분", () =>
    expect(classifyByDetour(7 * 60, 200)).toBe("DETOUR"));

  it("ΔD가 크면 DETOUR — 재라우팅으로 시간만 0인데 4.5km 더 돎", () =>
    expect(classifyByDetour(0, 4_500)).toBe("DETOUR"));

  it("ΔT 경계값+1 → DETOUR", () =>
    expect(classifyByDetour(ON_ROUTE_MAX_S + 1, 0)).toBe("DETOUR"));
  it("ΔD 경계값+1 → DETOUR", () =>
    expect(classifyByDetour(0, ON_ROUTE_MAX_D + 1)).toBe("DETOUR"));
});

describe("isOnRouteCandidate — STAGE 1 실측 대상 프리필터", () => {
  it("프리필터 경계값은 포함한다", () =>
    expect(isOnRouteCandidate(ON_ROUTE_PREFILTER_M)).toBe(true));
  it("경계값 초과는 재보지 않는다", () =>
    expect(isOnRouteCandidate(ON_ROUTE_PREFILTER_M + 1)).toBe(false));
});

describe("isOutOfRange", () => {
  it("T3_MAX 이하 → false", () => expect(isOutOfRange(T3_MAX)).toBe(false));
  it("T3_MAX 초과 → true", () => expect(isOutOfRange(T3_MAX + 0.001)).toBe(true));
});

describe("routeAvgSpeedKmh — 우회 허용 시간 게이트 전용 (AVG_SPEED 상수가 아님)", () => {
  it("도심 경로의 실제 속도를 그대로 반영한다", () => {
    // 남한산성입구역 → 단대오거리역: 3.7km / 15분 = 14.8km/h
    expect(routeAvgSpeedKmh(3_700, 15 * 60)).toBeCloseTo(14.8, 1);
  });

  it("고속도로 경로도 그대로 반영한다", () => {
    expect(routeAvgSpeedKmh(92_000, 94 * 60)).toBeCloseTo(58.7, 1);
  });

  it("정체(극단적 저속)는 하한으로 클램프한다", () => {
    expect(routeAvgSpeedKmh(1_000, 60 * 60)).toBe(ROUTE_SPEED_MIN_KMH);
  });

  it("심야 고속(극단적 고속)은 상한으로 클램프한다", () => {
    expect(routeAvgSpeedKmh(300_000, 60 * 60)).toBe(ROUTE_SPEED_MAX_KMH);
  });

  it("durationS가 0이면 하한을 쓴다 (0으로 나누지 않는다)", () => {
    expect(routeAvgSpeedKmh(1_000, 0)).toBe(ROUTE_SPEED_MIN_KMH);
  });
});

describe("estimateDetourDurationSAtSpeed", () => {
  it("도심 속도에서 1km 우회는 4분이 넘는다", () => {
    const speed = routeAvgSpeedKmh(3_700, 15 * 60); // 14.8km/h
    expect(estimateDetourDurationSAtSpeed(1_000, speed)).toBeGreaterThan(240);
  });

  it("AVG_SPEED(50km/h) 상수를 썼다면 같은 우회가 3분 미만으로 나왔을 것이다", () => {
    // 이 격차가 "5분까지만"을 눌러도 17분짜리가 통과하던 원인이다 (§7.2 STEP 7).
    expect(estimateDetourDurationSAtSpeed(1_000, 50)).toBeLessThan(180);
  });
});
