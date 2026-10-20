/** 관리자 운영·검색 지표 조회 — docs/ADMIN-DASHBOARD.md §5·§7. */

import { getDetailBackfillProgress, getLatestImportLog } from "@/infra/db/repositories";
import { getAdminSearchMetrics, type AdminSearchMetrics } from "@/infra/db/admin-metrics";
import type { Db } from "@/infra/db/client";

export type AdminDashboardRange = "24h" | "7d" | "30d";

export interface AdminDashboard {
  range: AdminDashboardRange;
  period: {
    since: string;
    until: string;
  };
  priceData: {
    latestImport: {
      pricedOn: string | null;
      status: string;
      startedAt: string;
      failedGate: string | null;
      detail: string | null;
      oilRows: number | null;
      lpgRows: number | null;
      geocoded: number | null;
    } | null;
    detailBackfill: {
      done: number;
      remaining: number;
      total: number;
    };
  };
  search: {
    completedCount: number;
    zeroResultRate: number;
    t3Rate: number;
    averageDurationMs: number | null;
    warningRate: number;
    jsonFallbackRate: number;
    averageDisplayedCandidates: number | null;
  };
  navi: {
    clickCount: number;
    clickRate: number;
    averageRank: number | null;
    byApp: Record<"KAKAO" | "NAVER" | "TMAP", number>;
    byTier: Record<"ON_ROUTE" | "DETOUR", number>;
  };
}

export interface GetAdminDashboardOptions {
  range: AdminDashboardRange;
  db?: Db;
  now?: Date;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function emptyAppCounts(): Record<"KAKAO" | "NAVER" | "TMAP", number> {
  return { KAKAO: 0, NAVER: 0, TMAP: 0 };
}

function emptyTierCounts(): Record<"ON_ROUTE" | "DETOUR", number> {
  return { ON_ROUTE: 0, DETOUR: 0 };
}

function buildAppCounts(metrics: AdminSearchMetrics): Record<"KAKAO" | "NAVER" | "TMAP", number> {
  const counts = emptyAppCounts();
  for (const row of metrics.naviClicksByApp) {
    if (row.app === "KAKAO" || row.app === "NAVER" || row.app === "TMAP") counts[row.app] = row.count;
  }
  return counts;
}

function buildTierCounts(metrics: AdminSearchMetrics): Record<"ON_ROUTE" | "DETOUR", number> {
  const counts = emptyTierCounts();
  for (const row of metrics.naviClicksByTier) {
    if (row.tier === "ON_ROUTE" || row.tier === "DETOUR") counts[row.tier] = row.count;
  }
  return counts;
}

function durationForRange(range: AdminDashboardRange): number {
  if (range === "24h") return 24 * 60 * 60 * 1_000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1_000;
  return 30 * 24 * 60 * 60 * 1_000;
}

export async function getAdminDashboard(
  options: GetAdminDashboardOptions,
): Promise<AdminDashboard> {
  const until = options.now ?? new Date();
  const since = new Date(until.getTime() - durationForRange(options.range));
  const [searchMetrics, latestImport, detailBackfill] = await Promise.all([
    getAdminSearchMetrics(since, options.db),
    getLatestImportLog(options.db),
    getDetailBackfillProgress(options.db),
  ]);
  const completedCount = searchMetrics.completedCount;

  return {
    range: options.range,
    period: { since: since.toISOString(), until: until.toISOString() },
    priceData: {
      latestImport: latestImport
        ? {
            pricedOn: latestImport.pricedOn,
            status: latestImport.status,
            startedAt: latestImport.startedAt.toISOString(),
            failedGate: latestImport.failedGate,
            detail: latestImport.detail,
            oilRows: latestImport.oilRows,
            lpgRows: latestImport.lpgRows,
            geocoded: latestImport.geocoded,
          }
        : null,
      detailBackfill,
    },
    search: {
      completedCount,
      zeroResultRate: rate(searchMetrics.zeroResultCount, completedCount),
      t3Rate: rate(searchMetrics.t3SearchCount, completedCount),
      averageDurationMs: searchMetrics.averageDurationMs,
      warningRate: rate(searchMetrics.warningSearchCount, completedCount),
      jsonFallbackRate: rate(searchMetrics.jsonFallbackSearchCount, completedCount),
      averageDisplayedCandidates: searchMetrics.averageDisplayedCandidates,
    },
    navi: {
      clickCount: searchMetrics.naviClickCount,
      clickRate: rate(searchMetrics.searchesWithNaviClick, completedCount),
      averageRank: searchMetrics.averageNaviRank,
      byApp: buildAppCounts(searchMetrics),
      byTier: buildTierCounts(searchMetrics),
    },
  };
}
