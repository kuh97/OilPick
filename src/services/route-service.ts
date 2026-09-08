/**
 * 경로 조회 — 기본 경로(R₀)·경유 경로(R_s) 공용.
 * ARCHITECTURE.md §9.1 STEP 1·STEP 10, §8 캐시 전략 (1시간 고정 TTL).
 */

import { fetchDirections } from "@/infra/kakao/mobility";
import { getRedis } from "@/infra/cache/redis";
import { routeKey, gridSnapWgs84 } from "@/infra/cache/keys";
import { env } from "@/infra/env";
import { wgs84 } from "@/domain/types";
import type { BaseRoute, Fuel, WGS84Point } from "@/domain/types";

const ROUTE_TTL_SECONDS = 60 * 60; // 1시간 — 교통 상황 반영 (§8)

// 경유지(주유소)는 gridSnapWgs84 기본값(2km, 반경검색용)으로 스냅하면 같은 격자 안의
// 서로 다른 주유소가 캐시 키를 공유해 남의 경유 경로를 대신 받는다 — 실측: 남한산성입구역↔
// 단대오거리역 사이 2km 격자 한 칸에 대성산업·에코충전소·성남에너지 등 5개 주유소가 들어가
// 우회거리가 최대 3배까지 틀어짐. §6.3 "정밀 계산은 후보당 카카오 API 1회"라는 정밀성
// 요구를 지키려면 경유지만은 격자를 실질적으로 무의미할 만큼 좁혀야 한다(부동소수점 요청
// 중복만 흡수).
const ROUTE_VIA_GRID_M = 10;

/** route-service·station-service가 공유하는 최소 Redis 인터페이스 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

interface CachedBaseRoute {
  distanceM: number;
  durationS: number;
  tollWon?: number;
  polyline: Array<{ lat: number; lng: number }>;
}

function serialize(route: BaseRoute): string {
  const payload: CachedBaseRoute = {
    distanceM: route.distanceM,
    durationS: route.durationS,
    tollWon: route.tollWon,
    polyline: route.polyline.map((p) => ({ lat: p.lat, lng: p.lng })),
  };
  return JSON.stringify(payload);
}

function deserialize(raw: string): BaseRoute {
  const cached = JSON.parse(raw) as CachedBaseRoute;
  return {
    distanceM: cached.distanceM,
    durationS: cached.durationS,
    tollWon: cached.tollWon,
    polyline: cached.polyline.map((p) => wgs84(p.lat, p.lng)),
  };
}

export interface GetRouteOptions {
  origin: WGS84Point;
  destination: WGS84Point;
  /** 경유지 — 있으면 경유 경로(R_s), 없으면 기본 경로(R₀) */
  waypoint?: WGS84Point;
  fuel?: Fuel;
  /** 기본 1(§5.4). STEP10 정밀 계산은 0을 넘기십시오 */
  retries?: number;
  redis?: RedisLike;
  prefix?: string;
}

/**
 * 경로 조회. 캐시 히트 시 카카오 호출 없이 반환합니다.
 * 실패는 그대로 throw합니다 — STEP1(전체 중단)과 STEP10(A8, 후보별 추정치 유지) 중
 * 무엇으로 다룰지는 호출자(recommendation-service)가 결정합니다.
 */
export async function getRoute(opts: GetRouteOptions): Promise<BaseRoute> {
  const redis: RedisLike = opts.redis ?? getRedis();
  const prefix = opts.prefix ?? env.REDIS_KEY_PREFIX;

  const originGrid = gridSnapWgs84(opts.origin);
  const destGrid = gridSnapWgs84(opts.destination);
  const viaGrid = opts.waypoint ? gridSnapWgs84(opts.waypoint, ROUTE_VIA_GRID_M) : undefined;
  const key = routeKey(prefix, originGrid, destGrid, viaGrid);

  const cached = await redis.get(key);
  if (cached) return deserialize(cached);

  const route = await fetchDirections({
    origin: opts.origin,
    destination: opts.destination,
    waypoint: opts.waypoint,
    fuel: opts.fuel,
    retries: opts.retries,
  });

  await redis.set(key, serialize(route), { ex: ROUTE_TTL_SECONDS });
  return route;
}
