"use client";

import { useQuery } from "@tanstack/react-query";

export type AdminDashboardRange = "24h" | "7d";

export interface AdminDashboardData {
  range: AdminDashboardRange;
  period: { since: string; until: string };
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
    detailBackfill: { done: number; remaining: number; total: number };
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
    byApp: { KAKAO: number; NAVER: number; TMAP: number };
    byTier: { ON_ROUTE: number; DETOUR: number };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isRate(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAdminDashboardData(value: unknown): value is AdminDashboardData {
  if (!isRecord(value)) return false;
  if (value.range !== "24h" && value.range !== "7d") return false;
  if (!isRecord(value.period) || typeof value.period.since !== "string" || typeof value.period.until !== "string") {
    return false;
  }
  if (!isRecord(value.priceData) || !isRecord(value.priceData.detailBackfill)) return false;
  const backfill = value.priceData.detailBackfill;
  if (!isCount(backfill.done) || !isCount(backfill.remaining) || !isCount(backfill.total)) return false;

  const latestImport = value.priceData.latestImport;
  if (latestImport !== null) {
    if (
      !isRecord(latestImport) ||
      !isNullableString(latestImport.pricedOn) ||
      typeof latestImport.status !== "string" ||
      typeof latestImport.startedAt !== "string" ||
      !isNullableString(latestImport.failedGate) ||
      !isNullableString(latestImport.detail) ||
      !isNullableNumber(latestImport.oilRows) ||
      !isNullableNumber(latestImport.lpgRows) ||
      !isNullableNumber(latestImport.geocoded)
    ) {
      return false;
    }
  }

  if (!isRecord(value.search)) return false;
  if (
    !isCount(value.search.completedCount) ||
    !isRate(value.search.zeroResultRate) ||
    !isRate(value.search.t3Rate) ||
    !isNullableNumber(value.search.averageDurationMs) ||
    !isRate(value.search.warningRate) ||
    !isRate(value.search.jsonFallbackRate) ||
    !isNullableNumber(value.search.averageDisplayedCandidates)
  ) {
    return false;
  }

  if (!isRecord(value.navi) || !isCount(value.navi.clickCount) || !isRate(value.navi.clickRate)) return false;
  if (
    !isNullableNumber(value.navi.averageRank) ||
    !isRecord(value.navi.byApp) ||
    !isCount(value.navi.byApp.KAKAO) ||
    !isCount(value.navi.byApp.NAVER) ||
    !isCount(value.navi.byApp.TMAP) ||
    !isRecord(value.navi.byTier) ||
    !isCount(value.navi.byTier.ON_ROUTE) ||
    !isCount(value.navi.byTier.DETOUR)
  ) {
    return false;
  }
  return true;
}

function getErrorMessage(value: unknown): string {
  if (!isRecord(value) || typeof value.message !== "string") {
    return "운영 지표를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  return value.message;
}

async function fetchAdminDashboard(
  range: AdminDashboardRange,
  signal: AbortSignal,
): Promise<AdminDashboardData> {
  const response = await fetch(`/api/admin/dashboard?range=${range}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(getErrorMessage(body));
  if (!isAdminDashboardData(body)) throw new Error("운영 지표 응답 형식이 올바르지 않습니다.");
  return body;
}

export function useAdminDashboard(range: AdminDashboardRange) {
  const query = useQuery({
    queryKey: ["admin-dashboard", range],
    queryFn: ({ signal }) => fetchAdminDashboard(range, signal),
  });

  return {
    dashboard: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    retry: () => void query.refetch(),
  };
}
