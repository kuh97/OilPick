/** 익명 검색·딥링크 이벤트 기록 — ARCHITECTURE.md §7.3, Phase 11. */

import type { SearchResult, Tier } from "@/domain/types";
import type { Facility, Fuel, WGS84Point } from "@/domain/types";
import type { NaviApp } from "@/domain/deeplink";
import { gridSnapWgs84 } from "@/infra/cache/keys";
import { getDb, type Db } from "@/infra/db/client";
import { naviClickEvent, searchEvent } from "@/infra/db/schema";

export interface LogSearchMeta {
  durationMs: number;
  fuel: Fuel;
  filters: {
    facilities: Facility[];
    brands: string[];
    kpetroOnly: boolean;
    selfOnly: boolean;
  };
  origin: WGS84Point;
  destination: WGS84Point;
  routeCalls: number;
  jsonFallback?: boolean;
  db?: Db;
}

/** POST /api/events/navi 바디와 같은 모양이지만, §2.1 의존 방향(app→services)을 지키기 위해
 * app/api의 zod 스키마 타입을 그대로 가져오지 않고 여기서 독립적으로 정의합니다. */
export interface NaviClickEvent {
  searchId: string;
  app: NaviApp;
  rank: number;
  tier: Tier;
  netSaving: number;
  detourDistanceM: number;
}

export async function logSearch(result: SearchResult, meta: LogSearchMeta): Promise<void> {
  const counts = result.candidates.reduce(
    (acc, candidate) => {
      acc[candidate.tier === "ON_ROUTE" ? "t1Count" : "t3Count"] += 1;
      return acc;
    },
    { t1Count: 0, t3Count: 0 },
  );

  await (meta.db ?? getDb()).insert(searchEvent).values({
    id: result.searchId,
    fuel: meta.fuel,
    filters: meta.filters,
    originCell: gridSnapWgs84(meta.origin),
    destCell: gridSnapWgs84(meta.destination),
    baseDistanceM: result.baseRoute.distanceM,
    baseDurationS: result.baseRoute.durationS,
    t1Count: counts.t1Count,
    t2Count: 0,
    t3Count: counts.t3Count,
    expansionTriggered: result.expansion.triggered,
    finalRadiusM: result.expansion.finalRadiusM,
    referencePrice: result.referencePrice,
    refPriceSource: result.refPriceSource,
    routeCalls: meta.routeCalls,
    durationMs: meta.durationMs,
    warnings: result.warnings.map((warning) => warning.code),
    jsonFallback: meta.jsonFallback ?? false,
  });
}

export async function logNaviClick(event: NaviClickEvent, db: Db = getDb()): Promise<void> {
  await db.insert(naviClickEvent).values({
    searchId: event.searchId,
    app: event.app,
    rank: event.rank,
    tier: event.tier,
    netSaving: event.netSaving,
    detourDistanceM: event.detourDistanceM,
  });
}
