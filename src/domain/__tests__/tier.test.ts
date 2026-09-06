import { describe, expect, it } from "vitest";
import { classifyTier, classifyTierByDetour, isOutOfRange, needsExpansion } from "../tier";
import { T1_MAX, T2_MAX, T3_MAX, DETOUR_ESTIMATE_FACTOR } from "../params";

describe("classifyTier", () => {
  it("d_perp=0 → T1", () => expect(classifyTier(0)).toBe("T1"));
  it(`경계값 T1_MAX(${T1_MAX}) → T1`, () => expect(classifyTier(T1_MAX)).toBe("T1"));
  it(`T1_MAX+1 → T2`, () => expect(classifyTier(T1_MAX + 1)).toBe("T2"));
  it(`T2_MAX(${T2_MAX}) → T2`, () => expect(classifyTier(T2_MAX)).toBe("T2"));
  it(`T2_MAX+1 → T3`, () => expect(classifyTier(T2_MAX + 1)).toBe("T3"));
  it(`T3_MAX(${T3_MAX}) → T3`, () => expect(classifyTier(T3_MAX)).toBe("T3"));
  it(`T3_MAX+1 → null (제거)`, () => expect(classifyTier(T3_MAX + 1)).toBeNull());
  it("매우 먼 거리 → null", () => expect(classifyTier(100_000)).toBeNull());
});

describe("classifyTierByDetour (실측 우회거리 기준 재판정)", () => {
  const t1Max = DETOUR_ESTIMATE_FACTOR * T1_MAX; // 1,000m
  const t2Max = DETOUR_ESTIMATE_FACTOR * T2_MAX; // 6,000m

  it("우회 0 → T1", () => expect(classifyTierByDetour(0)).toBe("T1"));
  it(`경계값 F×T1_MAX(${t1Max}) → T1`, () => expect(classifyTierByDetour(t1Max)).toBe("T1"));
  it("F×T1_MAX+1 → T2", () => expect(classifyTierByDetour(t1Max + 1)).toBe("T2"));
  it(`경계값 F×T2_MAX(${t2Max}) → T2`, () => expect(classifyTierByDetour(t2Max)).toBe("T2"));
  it("F×T2_MAX+1 → T3", () => expect(classifyTierByDetour(t2Max + 1)).toBe("T3"));
  it("아주 먼 우회 → T3 (상한 제거 없음 — A6가 담당)", () =>
    expect(classifyTierByDetour(100_000)).toBe("T3"));
  it("경계에서 추정 배지와 일치한다 — d_perp=T1_MAX인 후보의 ΔD̂와 같은 값이면 T1", () => {
    expect(classifyTierByDetour(DETOUR_ESTIMATE_FACTOR * T1_MAX)).toBe(classifyTier(T1_MAX));
  });
});

describe("isOutOfRange", () => {
  it("T3_MAX 이하 → false", () => expect(isOutOfRange(T3_MAX)).toBe(false));
  it("T3_MAX 초과 → true", () => expect(isOutOfRange(T3_MAX + 0.001)).toBe(true));
});

describe("needsExpansion", () => {
  it("T1+T2 합계가 minCandidates 미만 → true", () => {
    expect(needsExpansion(1, 1, 3)).toBe(true);
  });
  it("T1+T2 합계가 minCandidates 이상 → false", () => {
    expect(needsExpansion(2, 1, 3)).toBe(false);
    expect(needsExpansion(0, 3, 3)).toBe(false);
  });
  it("둘 다 0 → true", () => expect(needsExpansion(0, 0, 1)).toBe(true));
});
