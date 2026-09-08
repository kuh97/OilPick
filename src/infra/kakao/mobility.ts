/**
 * 카카오모빌리티 길찾기 (경유지 0~1개).
 * 타임아웃·재시도 — ARCHITECTURE.md §5.4
 *
 * 기본 경로(R₀): timeout 5s, retry 1회 (기본값)
 * 경유 경로(R_s): timeout 5s, retry 0회 — 호출자가 retries: 0을 넘깁니다
 */

import { env } from "@/infra/env";
import { KakaoDirectionsResponseSchema } from "./schema";
import { mapDirectionsRoute } from "./mapper";
import { fetchWithRetry } from "./http";
import type { BaseRoute, Fuel, WGS84Point } from "@/domain/types";

const TIMEOUT_MS = 5_000;

export interface FetchDirectionsOptions {
  origin: WGS84Point;
  destination: WGS84Point;
  /** 경유지. 이 서비스는 최대 1개만 씁니다 — ARCHITECTURE.md §5.2 */
  waypoint?: WGS84Point;
  fuel?: Fuel;
  /** true면 avoid=motorway — 고속도로·자동차전용도로를 피해 경로를 재탐색한다. */
  avoidHighway?: boolean;
  restApiKey?: string;
  /** 기본 1. 경유 경로 호출 시 0을 넘기십시오 (§5.4) */
  retries?: number;
}

function toKakaoCoord(p: WGS84Point): string {
  return `${p.lng},${p.lat}`;
}

/**
 * 길찾기 호출. 복수 경로를 반환해도 첫 번째(권장) 경로만 씁니다 (PRODUCT.md §6.1).
 */
export async function fetchDirections(opts: FetchDirectionsOptions): Promise<BaseRoute> {
  const restApiKey = opts.restApiKey ?? env.KAKAO_REST_API_KEY;
  const retries = opts.retries ?? 1;

  const params = new URLSearchParams({
    origin: toKakaoCoord(opts.origin),
    destination: toKakaoCoord(opts.destination),
    priority: "RECOMMEND",
  });
  if (opts.waypoint) params.set("waypoints", toKakaoCoord(opts.waypoint));
  if (opts.fuel) params.set("car_fuel", opts.fuel);
  if (opts.avoidHighway) params.set("avoid", "motorway");

  const url = `${env.KAKAO_MOBILITY_BASE_URL}/v1/directions?${params}`;
  const res = await fetchWithRetry(
    url,
    { Authorization: `KakaoAK ${restApiKey}` },
    TIMEOUT_MS,
    retries,
  );

  const json = await res.json();
  const parsed = KakaoDirectionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`카카오 길찾기 응답 파싱 실패: ${parsed.error.message}`);
  }

  const route = parsed.data.routes[0];
  if (!route || route.result_code !== 0) {
    throw new Error(`카카오 길찾기 실패 (result_code=${route?.result_code}): ${route?.result_msg ?? "경로 없음"}`);
  }

  return mapDirectionsRoute(route);
}
