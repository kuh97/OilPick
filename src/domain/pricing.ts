/**
 * 금액 계산 — NetSaving, TotalCost, Score, P_ref
 * PRODUCT.md §6.3 · §8
 *
 * 모든 함수 시그니처는 m·s·원(₩ 정수)을 받습니다 — AGENTS.md §7.4.
 * 연비(km/L), 시간가치(원/분) 변환은 함수 내부에서만 합니다.
 */

import {
  DETOUR_ESTIMATE_FACTOR,
  T3_GATE_DETOUR_FACTOR,
  AVG_SPEED,
  V_TIME,
  OUTLIER_SIGMA,
  P_REF_MIN_BASE,
  DETOUR_CAP_RATIO,
  DETOUR_TIME_CAP_RATIO,
  SHORT_ROUTE_DETOUR_TIME_CAP_S,
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

// ─── 우회 게이트 (STAGE 2) ───────────────────────────────────────────────────

/**
 * 게이트 전용 추정 우회거리 (m) — `T3_GATE_DETOUR_FACTOR`(1.0, 낙관적).
 * 후보를 영구 제외하는 판정(NetSaving 게이트·우회 허용 시간 예산)에는 전부 이 값을 쓴다
 * — 점수·정렬용 `estimateDetourDistanceM`(2.0)와 다르다 (불변식 7).
 */
export function gateDetourDistanceM(dPerpM: number): number {
  return dPerpM * T3_GATE_DETOUR_FACTOR;
}

/**
 * 우회 후보가 목록 진입 게이트를 통과하는지 — 추정치 기준 1회만 (불변식 7).
 * 경로상(🟢) 후보에는 걸지 않는다.
 */
export function passesDetourGate(args: {
  priceRefWon: number;
  priceStationWon: number;
  refuelAmountL: number;
  dPerpM: number;
  efficiencyKmPerL: number;
}): boolean {
  const estimatedDetour = args.dPerpM * T3_GATE_DETOUR_FACTOR;
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
 * "우회 허용 시간" 예산 안에 드는지 — 추정 단계에서 건다 (§7.2 STEP 7, 불변식 8).
 * `estimatedDetourDurationS`는 경로 실측 평균속도로 환산한 값 (`tier.routeAvgSpeedKmh`).
 */
export function withinDetourBudget(args: {
  estimatedDetourDurationS: number;
  maxDetourMinutes: number;
}): boolean {
  return args.estimatedDetourDurationS <= args.maxDetourMinutes * 60;
}

/**
 * "우회 허용 시간" 세그먼트 바의 상한(분, 5분 단위 내림) — 그 경로의 A6 cap에서 유도.
 * 30분 하드코딩 금지 — 짧은 경로에서 죽은 버튼이 생긴다 (§5.3 ⑥).
 */
export function maxDetourCeilingMinutes(base: { distanceM: number; durationS: number }): number {
  const capS =
    base.distanceM < MIN_ROUTE_DISTANCE
      ? SHORT_ROUTE_DETOUR_TIME_CAP_S
      : base.durationS * DETOUR_TIME_CAP_RATIO;
  return Math.max(5, Math.floor(capS / 60 / 5) * 5);
}

/**
 * 우회가 기본 경로 대비 상한(거리 DETOUR_CAP_RATIO · 시간 DETOUR_TIME_CAP_RATIO)을
 * 넘는지. 초과 시 후보 제거 (정밀 계산 이후에만 적용).
 *
 * **거리와 시간을 모두 봅니다.** 거리만 보면 재탐색으로 ΔD=0이 된 후보(실측 60%)를
 * 절대 거르지 못합니다 — 경로 99m 옆인데 실제로는 26.9km·39분을 우회해야 하는
 * 주유소가 그대로 1위권에 남았습니다 (Phase 10 실측, PRODUCT.md §10.1 A6).
 *
 * **`baseDistanceM`이 `MIN_ROUTE_DISTANCE` 미만이면 비율 cap 대신 절대 시간 상한
 * (`SHORT_ROUTE_DETOUR_TIME_CAP_S`)을 쓴다.** 원래(Phase 9)는 짧은 경로에서 이
 * cap을 아예 껐다 — 장거리 여행 전제로 만든 비율 cap이 2km 경로에서 1km로 수렴해
 * 수진역 LPG 같은 정당한 T3 후보까지 걸러냈기 때문이다. 그때 근거는 "T3_MAX·
 * NetSaving>0 게이트가 이미 범위를 제한하니 cap 없이도 무한정 찾아주진 않는다"였는데,
 * **이 근거가 틀렸다는 게 Phase 11 실측으로 드러났다**: 그 게이트들은 *추정*
 * (`2×d_perp`) 기준이라, 실측 우회가 추정을 100배 넘게 벗어나는 사례(§6.5)를 전혀
 * 못 거른다. 실제로 8분짜리 기본 경로(남한산성입구역→을지대학교, 최초로 이 예외를
 * 만들게 한 바로 그 경로)에 54분 우회가, 10분짜리 경로(단대오거리역→모란역)에
 * 45분 우회가 순절감액>0이라는 이유만으로 목록에 그대로 남았다 — 그마저 실측하면
 * 손해인 경우도 있었다. cap을 완전히 끄는 대신 절대 시간 상한을 두면, "1km 남짓
 * 우회하는 정당한 근거리 후보는 살리되(수진역 사례), 30~50분짜리 사실상 별도
 * 여정은 거른다"는 원래 취지 둘 다를 만족한다.
 */
export function exceedsDetourCap(args: {
  detourDistanceM: number;
  detourDurationS: number;
  baseDistanceM: number;
  baseDurationS: number;
}): boolean {
  if (args.baseDistanceM < MIN_ROUTE_DISTANCE) {
    return args.detourDurationS > SHORT_ROUTE_DETOUR_TIME_CAP_S;
  }
  if (args.detourDistanceM > args.baseDistanceM * DETOUR_CAP_RATIO) return true;
  return args.detourDurationS > args.baseDurationS * DETOUR_TIME_CAP_RATIO;
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
