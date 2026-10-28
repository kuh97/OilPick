import { describe, expect, it } from "vitest";
import * as P from "../params";

describe("params — 상수 불변식", () => {
  it("거리 경계가 단조증가한다", () => {
    expect(P.ON_ROUTE_CORRIDOR_MAX_M).toBe(300);
    expect(P.ON_ROUTE_CORRIDOR_MAX_M).toBeLessThan(P.T2_MAX);
    expect(P.T2_MAX).toBeLessThan(P.T3_MAX);
  });

  it("경로 실측 평균속도 클램프가 유효 구간을 이룬다", () => {
    expect(P.ROUTE_SPEED_MIN_KMH).toBeLessThan(P.ROUTE_SPEED_MAX_KMH);
    expect(P.ROUTE_SPEED_MIN_KMH).toBeGreaterThan(0);
  });

  it("P_REF_MIN_BASE 는 중앙값을 쓰는 최소 후보 수이다", () => {
    expect(P.P_REF_MIN_BASE).toBeGreaterThanOrEqual(1);
    expect(P.P_REF_MIN_BASE).toBeLessThanOrEqual(P.T3_MAX);
  });

  it("DETOUR_ESTIMATE_FACTOR 는 양수이다", () => {
    expect(P.DETOUR_ESTIMATE_FACTOR).toBeGreaterThan(0);
  });

  it("DEFAULT_EFFICIENCY 가 3개 연료를 모두 포함한다", () => {
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("GASOLINE");
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("DIESEL");
    expect(P.DEFAULT_EFFICIENCY).toHaveProperty("LPG");
  });
});
