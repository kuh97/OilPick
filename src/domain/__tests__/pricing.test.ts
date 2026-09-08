import { describe, expect, it } from "vitest";
import {
  netSaving,
  totalCost,
  computeScores,
  passesT3Gate,
  exceedsDetourCap,
  median,
  removeOutliers,
  computeReferencePrice,
  estimateDetourDistanceM,
  estimateDetourDurationS,
  effectiveDetourDistanceM,
  scoreByMode,
  durationSToMin,
  distanceMToKm,
} from "../pricing";
import {
  DETOUR_ESTIMATE_FACTOR,
  AVG_SPEED,
  MIN_ROUTE_DISTANCE,
  DETOUR_CAP_RATIO,
  DETOUR_TIME_CAP_RATIO,
  SHORT_ROUTE_DETOUR_TIME_CAP_S,
} from "../params";

// ─── 골든 테스트 (PRODUCT.md §5.3 예시) ───────────────────────────────────────
// P_ref=1800, P_s=1700, Q=45L, ΔD=2000m, E=12km/L
// NetSaving = (1800-1700)*45 - (2000/1000/12)*1700
//           = 4500 - 283.33... = 4216.67 → 4217 (round)
// TotalCost = 1700*45 + (2000/1000/12)*1700
//           = 76500 + 283.33... = 76783.33 → 76783 (round)
describe("골든 테스트 — PRODUCT.md §5.3", () => {
  const BASE = {
    priceRefWon: 1800,
    priceStationWon: 1700,
    refuelAmountL: 45,
    detourDistanceM: 2000,
    efficiencyKmPerL: 12,
  };

  it("netSaving 계산", () => {
    expect(netSaving(BASE)).toBe(4217);
  });

  it("totalCost 계산", () => {
    const tc = totalCost(BASE);
    expect(tc).toBe(76783);
  });
});

// ─── netSaving 경계값 ─────────────────────────────────────────────────────────
describe("netSaving 경계값", () => {
  it("P_s == P_ref → 우회 비용만큼 음수", () => {
    const result = netSaving({
      priceRefWon: 1700,
      priceStationWon: 1700,
      refuelAmountL: 45,
      detourDistanceM: 5000,
      efficiencyKmPerL: 12,
    });
    // (0)*45 - (5000/1000/12)*1700 = -(5/12)*1700 = -708.33 → -708
    expect(result).toBe(-708);
  });

  it("P_s > P_ref → 무조건 음수", () => {
    const result = netSaving({
      priceRefWon: 1600,
      priceStationWon: 1800,
      refuelAmountL: 45,
      detourDistanceM: 0,
      efficiencyKmPerL: 12,
    });
    expect(result).toBeLessThan(0);
  });

  it("우회 없으면 (P_ref − P_s) × Q", () => {
    const result = netSaving({
      priceRefWon: 1800,
      priceStationWon: 1700,
      refuelAmountL: 45,
      detourDistanceM: 0,
      efficiencyKmPerL: 12,
    });
    expect(result).toBe((1800 - 1700) * 45);
  });
});

// ─── totalCost ────────────────────────────────────────────────────────────────
describe("totalCost", () => {
  it("우회 없으면 Q × P_s", () => {
    const tc = totalCost({
      priceStationWon: 1700,
      refuelAmountL: 45,
      detourDistanceM: 0,
      efficiencyKmPerL: 12,
    });
    expect(tc).toBe(1700 * 45);
  });
});

// ─── computeScores ────────────────────────────────────────────────────────────
describe("computeScores", () => {
  it("balanced = TotalCost + (ΔT/60) × V_TIME", () => {
    const scores = computeScores({
      priceStationWon: 1700,
      refuelAmountL: 45,
      detourDistanceM: 0,
      detourDurationS: 600, // 10분
      efficiencyKmPerL: 12,
      timeValuePerMin: 200,
    });
    const tc = 1700 * 45;
    expect(scores.minCost).toBe(tc);
    expect(scores.balanced).toBe(Math.round(tc + (600 / 60) * 200));
  });

  // ΔD=0인데 ΔT>0인 후보가 실측의 60%다(Phase 10) — minDistance가 ΔD만 보면
  // 그 60%가 전부 0점 동점이 되어 "최단거리" 정렬이 무의미해진다.
  it("minDistance = 실질 우회 거리 — ΔD=0이어도 ΔT가 있으면 0이 아니다", () => {
    const scores = computeScores({
      priceStationWon: 1700,
      refuelAmountL: 45,
      detourDistanceM: 0,
      detourDurationS: 600, // 10분 → AVG_SPEED 환산 8,333m
      efficiencyKmPerL: 12,
      timeValuePerMin: 200,
    });
    expect(scores.minDistance).toBe(Math.round((600 / 3600) * AVG_SPEED * 1000));
  });

  it("minDistance = ΔD와 ΔT 환산값 중 큰 쪽", () => {
    const far = computeScores({
      priceStationWon: 1700, refuelAmountL: 45,
      detourDistanceM: 20_000, detourDurationS: 60, // 60s → 833m
      efficiencyKmPerL: 12, timeValuePerMin: 200,
    });
    expect(far.minDistance).toBe(20_000);
  });

  it("우회가 전혀 없으면 minDistance = 0", () => {
    const none = computeScores({
      priceStationWon: 1700, refuelAmountL: 45,
      detourDistanceM: 0, detourDurationS: 0,
      efficiencyKmPerL: 12, timeValuePerMin: 200,
    });
    expect(none.minDistance).toBe(0);
  });
});

// ─── effectiveDetourDistanceM ────────────────────────────────────────────────
describe("effectiveDetourDistanceM", () => {
  it("ΔT를 AVG_SPEED로 거리 환산해 ΔD와 비교, 큰 쪽을 반환", () => {
    expect(effectiveDetourDistanceM(0, 3600)).toBe(AVG_SPEED * 1000); // 1시간 = 50km
    expect(effectiveDetourDistanceM(100_000, 3600)).toBe(100_000);
  });

  it("둘 다 0이면 0", () => {
    expect(effectiveDetourDistanceM(0, 0)).toBe(0);
  });
});

// ─── passesT3Gate ────────────────────────────────────────────────────────────
describe("passesT3Gate", () => {
  it("충분히 저렴 → true", () => {
    expect(passesT3Gate({
      priceRefWon: 1800,
      priceStationWon: 1600,
      refuelAmountL: 45,
      dPerpM: 100,
      efficiencyKmPerL: 12,
    })).toBe(true);
  });

  it("비싸거나 우회비가 절감분을 초과 → false", () => {
    expect(passesT3Gate({
      priceRefWon: 1700,
      priceStationWon: 1700,
      refuelAmountL: 45,
      dPerpM: 10_000,
      efficiencyKmPerL: 12,
    })).toBe(false);
  });
});

// ─── exceedsDetourCap ────────────────────────────────────────────────────────
describe("exceedsDetourCap", () => {
  // MIN_ROUTE_DISTANCE 이상인 기본 경로에서만 cap이 적용되므로, cap 자체를 검증하는
  // 테스트는 그 이상의 base를 쓴다(짧은 경로 예외는 아래 별도 테스트에서 다룸).
  const LONG_BASE = MIN_ROUTE_DISTANCE; // 20,000m
  const LONG_BASE_S = 3600;             // 1시간
  const cap = (detourDistanceM: number, detourDurationS = 0, baseDistanceM = LONG_BASE) =>
    exceedsDetourCap({ detourDistanceM, detourDurationS, baseDistanceM, baseDurationS: LONG_BASE_S });

  it("우회가 기본경로 × CAP_RATIO 초과 → true", () => {
    // DETOUR_CAP_RATIO = 0.5
    expect(cap(LONG_BASE * 0.6)).toBe(true);
  });

  it("우회가 기본경로 × CAP_RATIO 이하 → false", () => {
    expect(cap(LONG_BASE * DETOUR_CAP_RATIO - 1)).toBe(false);
    expect(cap(LONG_BASE * DETOUR_CAP_RATIO)).toBe(false);
  });

  // 경유지를 넣으면 경로가 재탐색되어 거리는 그대로인데 시간만 늘어나는 경우가 실측의
  // 60%다 — 거리만 보면 "경로 99m 옆인데 실제 39분 우회"인 후보를 못 거른다.
  it("ΔD가 cap 이내여도 ΔT가 T_base × TIME_CAP_RATIO를 넘으면 → true", () => {
    expect(cap(0, LONG_BASE_S * DETOUR_TIME_CAP_RATIO + 1)).toBe(true);
  });

  it("ΔT가 경계값이면 → false", () => {
    expect(cap(0, LONG_BASE_S * DETOUR_TIME_CAP_RATIO)).toBe(false);
  });

  // 짧은 경로(D_base < MIN_ROUTE_DISTANCE)는 비율 cap 대신 SHORT_ROUTE_DETOUR_TIME_CAP_S
  // (20분) 절대 상한을 쓴다 — 비율 cap을 그대로 적용하면 정당한 우회까지 막히지만
  // (Phase 9, 수진역 LPG 사례), 완전히 끄면 순절감액>0(추정 기준)만으로 30~50분짜리
  // 우회가 통과한다(Phase 11 실측 — 단대오거리역→모란역, 남한산성입구역→을지대학교).
  const shortBase = MIN_ROUTE_DISTANCE - 1;
  const shortCap = (detourDurationS: number) => cap(0, detourDurationS, shortBase);

  it("짧은 경로 — 거리 비율로는 명백히 초과해도(50% cap이면 몇백 m대) 거리만으로는 걸리지 않는다", () => {
    expect(cap(shortBase * DETOUR_CAP_RATIO + 1, 0, shortBase)).toBe(false);
    expect(cap(10_000, 0, 2_000)).toBe(false); // 수진역 LPG와 같은 규모의 정당한 우회
  });

  it("짧은 경로 — 우회 시간이 SHORT_ROUTE_DETOUR_TIME_CAP_S(20분) 이하면 → false", () => {
    expect(shortCap(SHORT_ROUTE_DETOUR_TIME_CAP_S - 1)).toBe(false);
    expect(shortCap(SHORT_ROUTE_DETOUR_TIME_CAP_S)).toBe(false);
  });

  it("짧은 경로 — 우회 시간이 SHORT_ROUTE_DETOUR_TIME_CAP_S(20분)를 넘으면 → true (Phase 11 실측: 8분짜리 경로에 54분 우회가 그대로 남던 문제)", () => {
    expect(shortCap(SHORT_ROUTE_DETOUR_TIME_CAP_S + 1)).toBe(true);
    expect(cap(0, 3600, 2_000)).toBe(true); // 60분 우회 — 예전엔 통과했다
  });

  it("기본 경로가 MIN_ROUTE_DISTANCE 이상이면 기존처럼 cap을 적용한다", () => {
    expect(cap(LONG_BASE * DETOUR_CAP_RATIO + 1)).toBe(true);
    expect(cap(LONG_BASE * DETOUR_CAP_RATIO)).toBe(false);
  });
});

// ─── median ──────────────────────────────────────────────────────────────────
describe("median", () => {
  it("홀수 개 → 가운데 값", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("짝수 개 → 중간 두 값의 평균(반올림)", () => {
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2=2.5 → round=3
  });

  it("빈 배열 → 예외", () => {
    expect(() => median([])).toThrow();
  });

  it("원본 배열 변경 없음", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

// ─── removeOutliers ──────────────────────────────────────────────────────────
describe("removeOutliers", () => {
  it("정상 분포 → 거의 변화 없음", () => {
    const prices = [1700, 1710, 1720, 1730, 1740];
    const result = removeOutliers(prices);
    expect(result.length).toBe(prices.length);
  });

  it("극단값 제거", () => {
    // 10개의 정상값 + 1개의 이상치 → 이상치가 ±3σ 밖에 위치
    const normal = Array<number>(10).fill(1700);
    const prices = [...normal, 10000];
    const result = removeOutliers(prices);
    expect(result).not.toContain(10000);
    expect(result.length).toBeLessThan(prices.length);
  });

  it("1개 이하 → 원본 반환", () => {
    expect(removeOutliers([])).toEqual([]);
    expect(removeOutliers([1700])).toEqual([1700]);
  });
});

// ─── computeReferencePrice ───────────────────────────────────────────────────
describe("computeReferencePrice — P_ref 폴백 단계", () => {
  it("T1+T2 2개 이상 → MEDIAN_T1T2", () => {
    const result = computeReferencePrice([1700, 1720]);
    expect(result?.source).toBe("MEDIAN_T1T2");
    expect(result?.price).toBe(1710);
  });

  it("T1+T2 1개 & sigunguAvg 있음 → SIGUNGU_AVG", () => {
    const result = computeReferencePrice([1700], 1750);
    expect(result?.source).toBe("SIGUNGU_AVG");
    expect(result?.price).toBe(1750);
  });

  it("T1+T2 0개 & sigunguAvg 없음 → null", () => {
    expect(computeReferencePrice([])).toBeNull();
  });

  it("후보 1개 & sigunguAvg 없음 → null", () => {
    expect(computeReferencePrice([1700])).toBeNull();
  });
});

// ─── 추정 계산 ───────────────────────────────────────────────────────────────
describe("estimateDetourDistanceM", () => {
  it(`DETOUR_ESTIMATE_FACTOR(${DETOUR_ESTIMATE_FACTOR}) × d_perp`, () => {
    expect(estimateDetourDistanceM(1000)).toBe(DETOUR_ESTIMATE_FACTOR * 1000);
  });
});

describe("estimateDetourDurationS", () => {
  it(`AVG_SPEED(${AVG_SPEED}km/h) 기준 시간 추정`, () => {
    // 10km → 10/50h → 0.2h → 720s
    expect(estimateDetourDurationS(10_000)).toBeCloseTo(720, 5);
  });
});

// ─── 유틸 ────────────────────────────────────────────────────────────────────
describe("유틸", () => {
  it("durationSToMin: 초→분 반올림", () => {
    expect(durationSToMin(90)).toBe(2);
    expect(durationSToMin(60)).toBe(1);
    expect(durationSToMin(30)).toBe(1);
    expect(durationSToMin(29)).toBe(0);
  });

  it("distanceMToKm: m→km 소수 첫째 자리", () => {
    expect(distanceMToKm(1500)).toBe(1.5);
    expect(distanceMToKm(1000)).toBe(1.0);
    expect(distanceMToKm(2340)).toBe(2.3);
  });

  it("scoreByMode: 모드별 점수 선택", () => {
    const scores = { minDistance: 1000, minCost: 80000, balanced: 82000 };
    expect(scoreByMode(scores, "minDistance")).toBe(1000);
    expect(scoreByMode(scores, "minCost")).toBe(80000);
    expect(scoreByMode(scores, "balanced")).toBe(82000);
  });
});
