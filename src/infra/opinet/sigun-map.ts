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
const CACHE_TIMEOUT_MS = 3_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("시군구 매핑 Redis 타임아웃")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  // fetchAvgSigunPrice 내부의 오피넷 세마포어가 동시성을 제한하므로,
  // 시도별 조회를 순차 실행하지 않는다. 캐시 미스 시 17회가 순차로 쌓이면
  // Vercel 함수의 300초 제한을 쉽게 압박한다.
  const results = await Promise.all(
    areas.map((area) => fetchAvgSigunPrice({ sido: area.AREA_CD })),
  );
  const map = new Map<string, string>();
  for (const items of results) {
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
    try {
      const cached = await withTimeout(redis.get(key) as Promise<string | null>, CACHE_TIMEOUT_MS);
      if (cached) {
        try {
          return new Map(Object.entries(JSON.parse(cached) as Record<string, string>));
        } catch {
          // 캐시 손상 — 아래에서 새로 만든다
        }
      }
    } catch {
      // Redis 장애·타임아웃은 오피넷 원본 조회로 폴백한다.
    }
  }

  let map: Map<string, string>;
  try {
    map = await buildSigunMapFromOpinet();
  } catch (err) {
    // 기존 행의 sigun_cd는 import service가 보존한다. 새 행 일부의 매핑이
    // 비어도 가격·좌표 임포트 전체를 300초 타임아웃으로 실패시키지 않는다.
    console.warn(
      "[sigun-map] 오피넷 지역코드 조회 실패 — 기존 매핑을 보존하고 이번 임포트를 계속합니다",
      err instanceof Error ? err.message : String(err),
    );
    return new Map();
  }
  if (map.size > 0) {
    // 캐시 저장이 임포트 전체를 막지 않도록 best-effort로 처리한다.
    await withTimeout(
      redis.set(key, JSON.stringify(Object.fromEntries(map)), { ex: TTL_SECONDS }),
      CACHE_TIMEOUT_MS,
    ).catch(() => undefined);
  }
  return map;
}
