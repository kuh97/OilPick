/**
 * 티어 분류 — d_perp 기준 T1 / T2 / T3후보 / 제외
 * PRODUCT.md §6.4
 */

import { T1_MAX, T2_MAX, T3_MAX, DETOUR_ESTIMATE_FACTOR } from "./params";
import type { Tier } from "./types";

/**
 * d_perp(m) 로 티어를 반환합니다.
 * T3 게이트(NetSaving > 0)는 pricing 단계에서 적용하므로 여기서는 거리만 판정합니다.
 *
 * @returns 티어 또는 null (T3_MAX 초과 → 후보 제거)
 */
export function classifyTier(dPerpM: number): Tier | null {
  if (dPerpM <= T1_MAX) return "T1";
  if (dPerpM <= T2_MAX) return "T2";
  if (dPerpM <= T3_MAX) return "T3";
  return null; // 제거
}

/** T3_MAX 초과 여부 */
export function isOutOfRange(dPerpM: number): boolean {
  return dPerpM > T3_MAX;
}

/**
 * 실측 우회거리(ΔD)로 티어를 재판정 — STEP 10 정밀 계산을 마친 후보 전용 (PRODUCT.md §6.4).
 * 경계값은 `F × 기하 임계값`이라 추정 배지(ΔD̂ = F × d_perp)와 경계에서 일치한다.
 * 상한 제거는 없다(항상 T1~T3) — 우회 상한은 A6, 배지만 바꾸고 파이프라인 판정은 geoTier가 담당.
 */
export function classifyTierByDetour(detourDistanceM: number): Tier {
  if (detourDistanceM <= DETOUR_ESTIMATE_FACTOR * T1_MAX) return "T1";
  if (detourDistanceM <= DETOUR_ESTIMATE_FACTOR * T2_MAX) return "T2";
  return "T3";
}
