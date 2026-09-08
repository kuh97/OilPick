/**
 * 금액 계산 — NetSaving, TotalCost, Score, P_ref
 * PRODUCT.md §6.3 · §8
 *
 * 모든 함수 시그니처는 m·s·원(₩ 정수)을 받습니다 — AGENTS.md §7.4.
 * 연비(km/L), 시간가치(원/분) 변환은 함수 내부에서만 합니다.
 */

import {
  DETOUR_ESTIMATE_FACTOR,
  AVG_SPEED,
  V_TIME,
  OUTLIER_SIGMA,
  P_REF_MIN_BASE,
  DETOUR_CAP_RATIO,
  MIN_ROUTE_DISTANCE,
} from "./params";
import type { Mode, RefPriceSource, Scores } from "./types";

// ─── 우회 추정 ───────────────────────────────────────────────────────────────

/**
 * 우회 거리 추정 (m).
 * ΔD̂ = DETOUR_ESTIMATE_FACTOR × d_perp
 */
export function estimateDetourDistanceM(dPerpM: number): number {
  return DETOUR_ESTIMATE_FACTOR * dPerpM;
}

/**
 * 우회 시간 추정 (초).
 * ΔT̂ = ΔD̂ / 1000 / AVG_SPEED × 3600
 */
export function estimateDetourDurationS(detourDistanceM: number): number {
  return (detourDistanceM / 1000 / AVG_SPEED) * 3600;
}

/**
 * 실질 우회 거리 (m) — ΔD와 ΔT 중 **나쁜 쪽**을 거리 단위로 통일한 값.
 * `max(ΔD, ΔT × AVG_SPEED)`
 *
 * 경유지를 넣으면 카카오가 경로를 재탐색하므로 "거리는 같거나 짧은데 시간만 +10분"인
 * 경우가 흔합니다 (Phase 10 실측 — 추정 상위 40곳 중 **ΔD=0이 60%**, 그 중 다수가
 * ΔT 4~17분). `max(0, …)` 클램프(불변식 5)가 이 신호를 0으로 눌러버리기 때문에,
 * ΔD만 보는 판정(배지 재판정·최단거리 점수)은 "우회 없음"이라고 거짓말을 합니다.
 *
 * 시간을 AVG_SPEED로 거리 환산해 둘 중 큰 값을 쓰면, 기존 거리 기준 임계값
 * (F × T1_MAX 등)을 그대로 재사용하면서 시간 신호를 잃지 않습니다 — 새 임계값을
 * 표본 부족 상태로 추정할 필요가 없습니다 (PRODUCT.md §6.5).
 */
export function effectiveDetourDistanceM(detourDistanceM: number, detourDurationS: number): number {
  return Math.max(detourDistanceM, (detourDurationS / 3600) * AVG_SPEED * 1000);
}

// ─── 핵심 계산 ───────────────────────────────────────────────────────────────

/**
 * 순절감액 (원, 정수).
 * NetSaving = (P_ref − P_s) × Q − (ΔD / 1000 / E) × P_s
 *
 * 음수 가능 (T1·T2는 음수여도 목록 유지, T3는 음수면 제거).
 */
export function netSaving(args: {
  priceRefWon: number;       // P_ref (원/L)
  priceStationWon: number;   // P_s (원/L)
  refuelAmountL: number;     // Q (L)
  detourDistanceM: number;   // ΔD (m)
  efficiencyKmPerL: number;  // E (km/L)
}): number {
  const { priceRefWon, priceStationWon, refuelAmountL, detourDistanceM, efficiencyKmPerL } = args;
  const saving = (priceRefWon - priceStationWon) * refuelAmountL;
  const detourFuelCost = (detourDistanceM / 1000 / efficiencyKmPerL) * priceStationWon;
  return Math.round(saving - detourFuelCost);
}

/**
 * 여정 총비용 (원, 정수).
 * TotalCost = Q × P_s + (ΔD / 1000 / E) × P_s
 */
export function totalCost(args: {
  priceStationWon: number;
  refuelAmountL: number;
  detourDistanceM: number;
  efficiencyKmPerL: number;
}): number {
  const { priceStationWon, refuelAmountL, detourDistanceM, efficiencyKmPerL } = args;
  const fuelCost = priceStationWon * refuelAmountL;
  const detourFuelCost = (detourDistanceM / 1000 / efficiencyKmPerL) * priceStationWon;
  return Math.round(fuelCost + detourFuelCost);
}

/**
 * 3가지 모드 점수 계산.
 * 모두 최소화 문제 — PRODUCT.md §8.
 */
export function computeScores(args: {
  priceStationWon: number;
  refuelAmountL: number;
  detourDistanceM: number;   // ΔD (m)
  detourDurationS: number;   // ΔT (s)
  efficiencyKmPerL: number;
  timeValuePerMin: number;   // V_TIME (원/분)
}): Scores {
  const { priceStationWon, refuelAmountL, detourDistanceM, detourDurationS, efficiencyKmPerL, timeValuePerMin } = args;

  const tc = totalCost({ priceStationWon, refuelAmountL, detourDistanceM, efficiencyKmPerL });

  return {
    // "돌아가기 싫다"는 의도를 ΔD만으로 표현하면 실측 ΔD=0이 60%라 정렬이 무너진다
    // — 실질 우회 거리(ΔD와 ΔT 중 나쁜 쪽)를 쓴다 (PRODUCT.md §8).
    minDistance: Math.round(effectiveDetourDistanceM(detourDistanceM, detourDurationS)),
    minCost: tc,
    balanced: Math.round(tc + (detourDurationS / 60) * timeValuePerMin),
  };
}

// ─── T3 게이트 ───────────────────────────────────────────────────────────────

/**
 * T3 후보가 목록 진입 게이트를 통과하는지 확인.
 * ΔD̂(추정) 기준으로 1회만 적용합니다 — AGENTS.md §5 불변식 6.
 */
export function passesT3Gate(args: {
  priceRefWon: number;
  priceStationWon: number;
  refuelAmountL: number;
  dPerpM: number;
  efficiencyKmPerL: number;
}): boolean {
  const estimatedDetour = estimateDetourDistanceM(args.dPerpM);
  const saving = netSaving({
    priceRefWon: args.priceRefWon,
    priceStationWon: args.priceStationWon,
    refuelAmountL: args.refuelAmountL,
    detourDistanceM: estimatedDetour,
    efficiencyKmPerL: args.efficiencyKmPerL,
  });
  return saving > 0;
}

/**
 * 우회 거리가 기본 경로 대비 DETOUR_CAP_RATIO 초과 여부.
 * 초과 시 후보 제거 (정밀 계산 이후에만 적용).
 *
 * `baseDistanceM`이 `MIN_ROUTE_DISTANCE` 미만이면 이 비율 cap을 적용하지 않는다.
 * 이 규칙은 원래 장거리 여행에서 "우회가 절반을 넘으면 경로가 사실상 달라진
 * 것"을 막으려고 만들었는데, 짧은 경로에 그대로 적용하면 cap이 1~2km로
 * 수렴해 실제로 우회할 가치가 있는 후보까지 전부 제외된다(Phase 9 실측 —
 * 2km 경로에서 cap이 1km가 되어 수진역 LPG 같은 T3 후보가 전부 사라짐).
 * 짧은 경로에서는 T3_MAX(우회 탐색 상한)와 NetSaving>0 게이트만으로
 * "어느 정도 범위"를 이미 제한하므로 이 cap이 없어도 무한정 찾아주지 않는다.
 */
export function exceedsDetourCap(detourDistanceM: number, baseDistanceM: number): boolean {
  if (baseDistanceM < MIN_ROUTE_DISTANCE) return false;
  return detourDistanceM > baseDistanceM * DETOUR_CAP_RATIO;
}

// ─── P_ref 계산 ──────────────────────────────────────────────────────────────

/**
 * 중앙값 계산.
 * 입력 배열은 변경하지 않습니다.
 */
export function median(prices: number[]): number {
  if (prices.length === 0) throw new Error("median: 빈 배열");
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * T1+T2 풀에서 이상치(±OUTLIER_SIGMA σ)를 제거한 후 P_ref 계산.
 *
 * @param t1t2Prices T1+T2 주유소 가격 배열 (원/L)
 * @param sigunguAvg 시군구 평균가 폴백 (없으면 undefined)
 * @returns { price, source }
 */
export function computeReferencePrice(
  t1t2Prices: number[],
  sigunguAvg?: number,
): { price: number; source: RefPriceSource } | null {
  // 이상치 제거
  const pool = removeOutliers(t1t2Prices);

  if (pool.length >= P_REF_MIN_BASE) {
    return { price: median(pool), source: "MEDIAN_T1T2" };
  }

  if (sigunguAvg !== undefined) {
    return { price: sigunguAvg, source: "SIGUNGU_AVG" };
  }

  return null; // A14: 절감액 표시 생략
}

/**
 * 중앙값 ± OUTLIER_SIGMA × 표준편차 벗어나는 값 제거.
 */
export function removeOutliers(prices: number[]): number[] {
  if (prices.length < 2) return prices;

  const med = median(prices);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return prices;

  const lower = med - OUTLIER_SIGMA * stdDev;
  const upper = med + OUTLIER_SIGMA * stdDev;
  return prices.filter((p) => p >= lower && p <= upper);
}

// ─── 정렬 ────────────────────────────────────────────────────────────────────

/** 모드에 따른 점수 선택 */
export function scoreByMode(scores: Scores, mode: Mode): number {
  switch (mode) {
    case "minCost":     return scores.minCost;
    case "minDistance": return scores.minDistance;
    case "balanced":    return scores.balanced;
  }
}

/** ΔT (초) → 분 반올림 */
export function durationSToMin(durationS: number): number {
  return Math.round(durationS / 60);
}

/** ΔD (m) → km (소수 첫째 자리) */
export function distanceMToKm(distanceM: number): number {
  return Math.round(distanceM / 100) / 10;
}

/** V_TIME 기본값 export (테스트·UI에서 참조용) */
export { V_TIME };
