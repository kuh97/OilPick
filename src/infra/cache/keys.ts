/**
 * Redis 키 생성 규칙.
 * 모든 키에 REDIS_KEY_PREFIX(dev/prod)를 접두사로 붙입니다.
 * ARCHITECTURE.md §8
 */

import { wgs84ToProjected } from "@/domain/geo";
import type { WGS84Point } from "@/domain/types";

/** 2km 격자 스냅 — 반경검색 캐시 키 중복 최대화 */
const STATION_GRID_M = 2_000;

function snapToGrid(coord: number, gridSize: number): number {
  return Math.round(coord / gridSize) * gridSize;
}

/**
 * WGS84 좌표를 2km 격자로 스냅한 문자열로 변환.
 * `routeKey`/`placeKey`의 grid 인자를 만드는 데 쓰고, Phase 11 익명 이벤트 로깅의
 * `origin_cell`/`dest_cell`도 같은 함수를 재사용합니다 (§8.3).
 *
 * @param point WGS84 좌표
 * @param gridM 격자 크기 (m). 기본 2,000
 */
export function gridSnapWgs84(point: WGS84Point, gridM: number = STATION_GRID_M): string {
  const projected = wgs84ToProjected(point);
  const gx = snapToGrid(projected.x, gridM);
  const gy = snapToGrid(projected.y, gridM);
  return `${gx}_${gy}`;
}

/**
 * 경로 캐시 키 (1시간 TTL).
 * 격자 기반으로 동일 구간 경로를 공유합니다.
 * Phase 4 (카카오 infra)에서 사용.
 *
 * @param prefix REDIS_KEY_PREFIX
 * @param originGrid "lat_lng" 스냅 문자열
 * @param destGrid   "lat_lng" 스냅 문자열
 * @param viaGrid    경유지 스냅 (없으면 생략)
 * @param avoidHighway avoid=motorway로 조회한 경로인지 — 켜고 끈 결과는 완전히 다른
 *   경로라 같은 origin/destination/waypoint라도 키를 반드시 분리해야 한다. 빠뜨리면
 *   회피를 켠 사용자가 끈 사용자의(또는 그 반대) 캐시된 경로를 그대로 받는다.
 */
export function routeKey(
  prefix: string,
  originGrid: string,
  destGrid: string,
  viaGrid?: string,
  avoidHighway?: boolean,
): string {
  const via = viaGrid ? `:${viaGrid}` : "";
  const avoid = avoidHighway ? ":avoid" : "";
  return `${prefix}:route:${originGrid}:${destGrid}${via}${avoid}`;
}

/**
 * 장소 검색 캐시 키 (24시간 TTL).
 * Phase 4 (카카오 infra)에서 사용.
 */
export function placeKey(prefix: string, query: string): string {
  return `${prefix}:place:${encodeURIComponent(query)}`;
}
