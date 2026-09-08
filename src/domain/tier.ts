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
 *
 * **ΔT를 여기 섞지 마십시오.** 실측 ΔT를 거리로 환산해(`effectiveDetourDistanceM`)
 * 판정하면 "경로 117m 옆인데 7분 걸림" 같은 후보가 🟡우회 배지를 다는데, 우회 고지
 * 배너는 geoTier(d_perp) 기준이라 켜지지 않아 **배지와 배너가 어긋납니다** — §6.4가
 * 금지하는 바로 그 상태입니다(실측 확인: T3 배지 6개 vs 배너 OFF). 우회 시간은 배지가
 * 아니라 카드 본문의 `+N분 · +N km 우회`가 실측값으로 이미 정직하게 전달하고,
 * 시간이 과도한 후보는 A6 시간 cap이 목록에서 제거합니다.
 */
export function classifyTierByDetour(detourDistanceM: number): Tier {
  if (detourDistanceM <= DETOUR_ESTIMATE_FACTOR * T1_MAX) return "T1";
  if (detourDistanceM <= DETOUR_ESTIMATE_FACTOR * T2_MAX) return "T2";
  return "T3";
}
