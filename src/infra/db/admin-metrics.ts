/** 관리자 대시보드용 익명 집계 쿼리 — docs/ADMIN-DASHBOARD.md §5·§7. */

import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { naviClickEvent, searchEvent } from "./schema";

export interface AdminSearchMetrics {
  completedCount: number;
  zeroResultCount: number;
  t3SearchCount: number;
  averageDurationMs: number | null;
  warningSearchCount: number;
  jsonFallbackSearchCount: number;
  averageDisplayedCandidates: number | null;
  naviClickCount: number;
  searchesWithNaviClick: number;
  averageNaviRank: number | null;
  naviClicksByApp: Array<{ app: string; count: number }>;
  naviClicksByTier: Array<{ tier: string; count: number }>;
}

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getAdminSearchMetrics(
  since: Date,
  db: Db = getDb(),
): Promise<AdminSearchMetrics> {
  const [searchRow] = await db
    .select({
      completedCount: sql<number>`COUNT(*)`,
      zeroResultCount: sql<number>`COUNT(*) FILTER (WHERE ${searchEvent.t1Count} + ${searchEvent.t3Count} = 0)`,
      t3SearchCount: sql<number>`COUNT(*) FILTER (WHERE ${searchEvent.t3Count} > 0)`,
      averageDurationMs: sql<number | null>`AVG(${searchEvent.durationMs})`,
      warningSearchCount: sql<number>`COUNT(*) FILTER (WHERE COALESCE(array_length(${searchEvent.warnings}, 1), 0) > 0)`,
      jsonFallbackSearchCount: sql<number>`COUNT(*) FILTER (WHERE ${searchEvent.jsonFallback})`,
      averageDisplayedCandidates: sql<number | null>`AVG((${searchEvent.t1Count} + ${searchEvent.t3Count})::float8)`,
    })
    .from(searchEvent)
    .where(gte(searchEvent.createdAt, since));

  const [naviRow] = await db
    .select({
      naviClickCount: sql<number>`COUNT(${naviClickEvent.id})`,
      searchesWithNaviClick: sql<number>`COUNT(DISTINCT ${naviClickEvent.searchId})`,
      averageNaviRank: sql<number | null>`AVG(${naviClickEvent.rank})`,
    })
    .from(searchEvent)
    .leftJoin(
      naviClickEvent,
      and(
        eq(naviClickEvent.searchId, searchEvent.id),
        gte(naviClickEvent.createdAt, since),
      ),
    )
    .where(gte(searchEvent.createdAt, since));

  const appRows = await db
    .select({
      app: naviClickEvent.app,
      count: sql<number>`COUNT(*)`,
    })
    .from(searchEvent)
    .innerJoin(
      naviClickEvent,
      and(
        eq(naviClickEvent.searchId, searchEvent.id),
        gte(naviClickEvent.createdAt, since),
      ),
    )
    .where(gte(searchEvent.createdAt, since))
    .groupBy(naviClickEvent.app);

  const tierRows = await db
    .select({
      tier: naviClickEvent.tier,
      count: sql<number>`COUNT(*)`,
    })
    .from(searchEvent)
    .innerJoin(
      naviClickEvent,
      and(
        eq(naviClickEvent.searchId, searchEvent.id),
        gte(naviClickEvent.createdAt, since),
      ),
    )
    .where(gte(searchEvent.createdAt, since))
    .groupBy(naviClickEvent.tier);

  return {
    completedCount: toNumber(searchRow?.completedCount),
    zeroResultCount: toNumber(searchRow?.zeroResultCount),
    t3SearchCount: toNumber(searchRow?.t3SearchCount),
    averageDurationMs: toNullableNumber(searchRow?.averageDurationMs),
    warningSearchCount: toNumber(searchRow?.warningSearchCount),
    jsonFallbackSearchCount: toNumber(searchRow?.jsonFallbackSearchCount),
    averageDisplayedCandidates: toNullableNumber(searchRow?.averageDisplayedCandidates),
    naviClickCount: toNumber(naviRow?.naviClickCount),
    searchesWithNaviClick: toNumber(naviRow?.searchesWithNaviClick),
    averageNaviRank: toNullableNumber(naviRow?.averageNaviRank),
    naviClicksByApp: appRows.map((row) => ({ app: row.app, count: toNumber(row.count) })),
    naviClicksByTier: tierRows.map((row) => ({ tier: row.tier, count: toNumber(row.count) })),
  };
}
