import { describe, expect, it } from "vitest";
import * as P from "../params";

describe("params — 상수 불변식", () => {
  it("티어 경계가 단조증가한다", () => {
    expect(P.T1_MAX).toBeLessThan(P.T2_MAX);
    expect(P.T2_MAX).toBeLessThan(P.T3_MAX);
  });

  it("P_REF_MIN_BASE 는 T1+T2 중앙값을 쓰는 최소 후보 수이다", () => {
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
