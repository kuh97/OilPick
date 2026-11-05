/** 실측 경로상 / 우회 판정과 검색용 범위 보조 함수 — PRODUCT.md §6.4 */

import {
  T3_MAX,
  ON_ROUTE_MAX_S,
  ON_ROUTE_MAX_D,
  DETOUR_SEARCH_BUFFER_M,
} from "./params";
import type { Tier } from "./types";

/**
 * 실제 경로의 실측값으로 배지를 판정한다.
 * 검색은 Valhalla 실측값을, 상세는 Kakao 실측값을 이 함수에 전달한다.
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

/** 선택 거리 + 여유 3km로 DB 검색 반경을 만들고, 전체 상한 15km를 넘기지 않는다. */
export function detourSearchRadiusM(maxDetourDistanceM: number): number {
  return Math.min(maxDetourDistanceM + DETOUR_SEARCH_BUFFER_M, T3_MAX);
}
