import { describe, expect, it } from "vitest";
import { buildReason } from "../reason";
import type { ReasonInput } from "../reason";

const BASE: ReasonInput = {
  rank: 2,
  tier: "DETOUR",
  priceRefWon: 1800,
  priceStationWon: 1700,
  priceRankAmongAll: 2,
  totalCandidates: 5,
  detourDistanceM: 3000,    // 3km
  detourDurationS: 360,     // 6분
  hasFacilityMatch: false,
  mode: "balanced",
};

describe("buildReason — 6분기 전부 커버", () => {
  it("분기 1: rank==1 && T3 → 우회km·리터당원 문구", () => {
    const result = buildReason({ ...BASE, rank: 1, tier: "DETOUR", detourDistanceM: 5000 });
    expect(result).toContain("우회하지만");
    expect(result).toContain("리터당");
    expect(result).toContain("100"); // priceDiff = 1800-1700 = 100
  });

  it("분기 2: rank==1 && 경로상 → 가는 길 문구", () => {
    const result = buildReason({ ...BASE, rank: 1, tier: "ON_ROUTE", priceRankAmongAll: 3 });
    expect(result).toContain("가는 길에 들를 수 있");
    expect(result).toContain("3번째로 저렴");
  });

  it("분기 3a: priceRankAmongAll==1 && 우회 있음 → 가장 저렴 + 우회 경고", () => {
    const result = buildReason({ ...BASE, priceRankAmongAll: 1, detourDistanceM: 2000 });
    expect(result).toContain("가장 저렴");
    expect(result).toContain("우회");
    expect(result).toContain("2km");
  });

  it("분기 3b: priceRankAmongAll==1 && 우회 없음 → 가장 저렴(우회 생략)", () => {
    const result = buildReason({ ...BASE, priceRankAmongAll: 1, detourDistanceM: 0 });
    expect(result).toBe("이 경로에서 가장 저렴합니다.");
  });

  it("분기 4: 경로상 && detourMin==0 → 우회 없음 문구", () => {
    const result = buildReason({ ...BASE, tier: "ON_ROUTE", detourDurationS: 20 }); // 20s → 0분
    expect(result).toContain("가는 길에 그대로");
    expect(result).toContain("우회 없음");
  });

  it("분기 5: 경로상 && ΔT>0 → N분만 더 걸린다 문구", () => {
    const result = buildReason({ ...BASE, tier: "ON_ROUTE", detourDurationS: 120 }); // 2분
    expect(result).toContain("가는 길에 들를 수 있");
    expect(result).toContain("2분");
  });

  it("분기 6: hasFacilityMatch → 조건 문구", () => {
    const result = buildReason({ ...BASE, hasFacilityMatch: true, detourDurationS: 600 });
    expect(result).toContain("조건에 맞는 곳");
  });

  it("분기 7: 그 외 → 균형 문구", () => {
    const result = buildReason({ ...BASE, detourDurationS: 600 }); // 10분, T2, hasFacilityMatch=false
    expect(result).toBe("가격과 우회 거리의 균형이 좋습니다.");
  });

  it("분기 1 우선순위 — rank==1 T3는 분기 2·3·4보다 앞", () => {
    const result = buildReason({
      ...BASE,
      rank: 1,
      tier: "DETOUR",
      priceRankAmongAll: 1,
      detourDistanceM: 5000,
      detourDurationS: 60,
    });
    expect(result).toContain("우회하지만");
  });
});
