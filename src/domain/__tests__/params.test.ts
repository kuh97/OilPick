import { describe, expect, it } from "vitest";
import * as P from "../params";

describe("params — 상수 불변식", () => {
  it("거리 경계가 단조증가한다", () => {
    expect(P.ON_ROUTE_PREFILTER_MAX_M).toBeLessThan(P.T2_MAX);
    expect(P.T2_MAX).toBeLessThan(P.T3_MAX);
  });

  it("경로상 사전 범위는 300m이다", () => {
    expect(P.ON_ROUTE_PREFILTER_MAX_M).toBe(300);
  });

  it("P_REF_MIN_BASE 는 중앙값을 쓰는 최소 후보 수이다", () => {
    expect(P.P_REF_MIN_BASE).toBeGreaterThanOrEqual(1);
    expect(P.P_REF_MIN_BASE).toBeLessThanOrEqual(P.T3_MAX);
  });

  it("우회 거리 선택지는 3·5·10·15km이고 기본값은 5km이다", () => {
    expect(P.DETOUR_DISTANCE_OPTIONS_KM).toEqual([3, 5, 10, 15]);
    expect(P.DEFAULT_MAX_DETOUR_DISTANCE_KM).toBe(5);
    expect(P.DETOUR_SEARCH_BUFFER_M).toBe(3_000);
  });

  it("DEFAULT_EFFICIENCY 가 3개 연료를 모두 포함한다", () => {
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("GASOLINE");
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("DIESEL");
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("LPG");
  });
});
