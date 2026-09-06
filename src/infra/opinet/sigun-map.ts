/**
 * CSV '지역' 텍스트("강원 강릉시") → 오피넷 SIGUNCD 매핑.
 * docs/MIGRATION-DB.md §3.3 — avgSigunPrice.do의 SIGUNNM과 글자 단위로 정확히
 * 일치합니다(정규화 불필요, 실측 230/230).
 *
 * 이 표는 사실상 정적이라(시군구 코드는 거의 안 바뀜) Redis에 30일 캐시합니다.
 * 캐시 미스일 때만 오피넷을 17회(areaCode.do 1 + avgSigunPrice.do 16) 호출합니다 —
 * 매일 도는 크론이 오피넷에 매번 의존하지 않도록.
 */

import { fetchAreaCodes, fetchAvgSigunPrice } from "./client";
import { getRedis } from "@/infra/cache/redis";
import { env } from "@/infra/env";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

function cacheKey(prefix: string): string {
  return `${prefix}:opinet:sigun-map`;
}

export interface SigunMapDeps {
  redis?: { get(key: string): Promise<string | null>; set(key: string, value: string, opts?: { ex?: number }): Promise<unknown> };
  prefix?: string;
  /** true면 캐시를 무시하고 오피넷에서 새로 만든다 (Phase A 최초 구축용) */
  forceRefresh?: boolean;
}

/** 오피넷 areaCode.do + avgSigunPrice.do로 매핑을 새로 만든다 (17회 호출). */
export async function buildSigunMapFromOpinet(): Promise<Map<string, string>> {
  const areas = await fetchAreaCodes();
  const map = new Map<string, string>();
  for (const area of areas) {
    const items = await fetchAvgSigunPrice({ sido: area.AREA_CD });
    for (const item of items) map.set(item.SIGUNNM, item.SIGUNCD);
  }
  return map;
}

/**
 * 지역→SIGUNCD 매핑을 얻는다. 캐시 히트면 오피넷 호출 0회.
 * 반환된 Map은 읽기 전용으로 다루십시오.
 */
export async function getSigunMap(deps: SigunMapDeps = {}): Promise<Map<string, string>> {
  const redis = deps.redis ?? getRedis();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const key = cacheKey(prefix);

  if (!deps.forceRefresh) {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return new Map(Object.entries(JSON.parse(cached) as Record<string, string>));
      } catch {
        // 캐시 손상 — 아래에서 새로 만든다
      }
    }
  }

  const map = await buildSigunMapFromOpinet();
  if (map.size > 0) {
    await redis.set(key, JSON.stringify(Object.fromEntries(map)), { ex: TTL_SECONDS });
  }
  return map;
}
