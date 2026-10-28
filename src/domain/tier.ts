/** 실측 경로상 / 우회 판정과 검색용 범위 보조 함수 — PRODUCT.md §6.4 */

import {
  T3_MAX,
  ON_ROUTE_MAX_S,
  ON_ROUTE_MAX_D,
  ROUTE_SPEED_MIN_KMH,
  ROUTE_SPEED_MAX_KMH,
} from "./params";
import type { Tier } from "./types";

/**
 * 상세에서 확정한 실측값으로 배지를 판정한다.
 * 검색 목록은 이 함수를 호출하지 않고 도로 링크 방향과 T2 범위로 먼저 정리한다.
 */
export function classifyByDetour(
  detourDurationS: number,
  detourDistanceM: number,
): Tier {
  return detourDurationS <= ON_ROUTE_MAX_S && detourDistanceM <= ON_ROUTE_MAX_D
    ? "ON_ROUTE"
    : "DETOUR";
}

/** `T3_MAX` 초과 여부 — 회랑 bbox가 실제 회랑보다 넓게 잡히는 만큼을 걸러냅니다. */
export function isOutOfRange(dPerpM: number): boolean {
  return dPerpM > T3_MAX;
}

/** 그 경로의 실측 평균속도(km/h) — 우회 허용 시간 게이트 전용, `AVG_SPEED` 상수 아님 (§7.2 STEP 7). */
export function routeAvgSpeedKmh(
  baseDistanceM: number,
  baseDurationS: number,
): number {
  if (baseDurationS <= 0) return ROUTE_SPEED_MIN_KMH;
  const kmh = baseDistanceM / 1000 / (baseDurationS / 3600);
  return Math.min(ROUTE_SPEED_MAX_KMH, Math.max(ROUTE_SPEED_MIN_KMH, kmh));
}

/** 추정 우회거리(m)를 그 경로의 실측 평균속도로 시간(초) 환산 — §7.2 STEP 7. */
export function estimateDetourDurationSAtSpeed(
  detourDistanceM: number,
  speedKmh: number,
): number {
  return (detourDistanceM / 1000 / speedKmh) * 3600;
}
