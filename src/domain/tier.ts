/** 경로상 / 우회 판정 — PRODUCT.md §6.4, AGENTS.md 불변식 6·6a */

import {
  T3_MAX,
  ON_ROUTE_MAX_S,
  ON_ROUTE_MAX_D,
  ON_ROUTE_PREFILTER_M,
  ROUTE_SPEED_MIN_KMH,
  ROUTE_SPEED_MAX_KMH,
} from "./params";
import type { Tier } from "./types";

/**
 * 배지 판정 — `ΔT ≤ ON_ROUTE_MAX_S` AND `ΔD ≤ ON_ROUTE_MAX_D`면 경로상 (§6.4).
 * 실측값을 넘긴다. 실측 실패(A8) 후보만 추정치, 카드는 "약" 표기 유지 (불변식 4).
 */
export function classifyByDetour(detourDurationS: number, detourDistanceM: number): Tier {
  return detourDurationS <= ON_ROUTE_MAX_S && detourDistanceM <= ON_ROUTE_MAX_D
    ? "ON_ROUTE"
    : "DETOUR";
}

/** `T3_MAX` 초과 여부 — 회랑 bbox가 실제 회랑보다 넓게 잡히는 만큼을 걸러냅니다. */
export function isOutOfRange(dPerpM: number): boolean {
  return dPerpM > T3_MAX;
}

/** STAGE 1 실측 대상 프리필터 — `d_perp ≤ ON_ROUTE_PREFILTER_M` (§6.4). */
export function isOnRouteCandidate(dPerpM: number): boolean {
  return dPerpM <= ON_ROUTE_PREFILTER_M;
}

/** 그 경로의 실측 평균속도(km/h) — 우회 허용 시간 게이트 전용, `AVG_SPEED` 상수 아님 (§7.2 STEP 7). */
export function routeAvgSpeedKmh(baseDistanceM: number, baseDurationS: number): number {
  if (baseDurationS <= 0) return ROUTE_SPEED_MIN_KMH;
  const kmh = baseDistanceM / 1000 / (baseDurationS / 3600);
  return Math.min(ROUTE_SPEED_MAX_KMH, Math.max(ROUTE_SPEED_MIN_KMH, kmh));
}

/** 추정 우회거리(m)를 그 경로의 실측 평균속도로 시간(초) 환산 — §7.2 STEP 7. */
export function estimateDetourDurationSAtSpeed(detourDistanceM: number, speedKmh: number): number {
  return (detourDistanceM / 1000 / speedKmh) * 3600;
}
