import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminSearchMetricsMock, getLatestImportLogMock, getDetailBackfillProgressMock } = vi.hoisted(() => ({
  getAdminSearchMetricsMock: vi.fn(),
  getLatestImportLogMock: vi.fn(),
  getDetailBackfillProgressMock: vi.fn(),
}));

vi.mock("@/infra/db/admin-metrics", () => ({
  getAdminSearchMetrics: getAdminSearchMetricsMock,
}));
vi.mock("@/infra/db/repositories", () => ({
  getLatestImportLog: getLatestImportLogMock,
  getDetailBackfillProgress: getDetailBackfillProgressMock,
}));

import { getAdminDashboard } from "../admin-dashboard-service";

const NOW = new Date("2026-10-20T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  getLatestImportLogMock.mockResolvedValue({
    pricedOn: "2026-10-19",
    status: "OK",
    startedAt: new Date("2026-10-19T15:00:00.000Z"),
    failedGate: null,
    detail: null,
    oilRows: 10_245,
    lpgRows: 1_842,
    geocoded: 3,
  });
  getDetailBackfillProgressMock.mockResolvedValue({ done: 900, remaining: 100, total: 1_000 });
  getAdminSearchMetricsMock.mockResolvedValue({
    completedCount: 10,
    zeroResultCount: 2,
    t3SearchCount: 4,
    averageDurationMs: 1_850.5,
    warningSearchCount: 1,
    jsonFallbackSearchCount: 3,
    averageDisplayedCandidates: 4.2,
    naviClickCount: 7,
    searchesWithNaviClick: 5,
    averageNaviRank: 1.8,
    naviClicksByApp: [
      { app: "KAKAO", count: 4 },
      { app: "NAVER", count: 3 },
    ],
    naviClicksByTier: [{ tier: "ON_ROUTE", count: 6 }, { tier: "DETOUR", count: 1 }],
  });
});

describe("getAdminDashboard", () => {
  it("7일 기간과 운영·검색·내비 지표를 안전한 DTO로 반환한다", async () => {
    const result = await getAdminDashboard({ range: "7d", now: NOW });

    expect(result.period).toEqual({
      since: "2026-10-13T00:00:00.000Z",
      until: "2026-10-20T00:00:00.000Z",
    });
    expect(result.priceData).toEqual({
      latestImport: {
        pricedOn: "2026-10-19",
        status: "OK",
        startedAt: "2026-10-19T15:00:00.000Z",
        failedGate: null,
        detail: null,
        oilRows: 10_245,
        lpgRows: 1_842,
        geocoded: 3,
      },
      detailBackfill: { done: 900, remaining: 100, total: 1_000 },
    });
    expect(result.search).toEqual({
      completedCount: 10,
      zeroResultRate: 0.2,
      t3Rate: 0.4,
      averageDurationMs: 1_850.5,
      warningRate: 0.1,
      jsonFallbackRate: 0.3,
      averageDisplayedCandidates: 4.2,
    });
    expect(result.navi).toEqual({
      clickCount: 7,
      clickRate: 0.5,
      averageRank: 1.8,
      byApp: { KAKAO: 4, NAVER: 3, TMAP: 0 },
      byTier: { ON_ROUTE: 6, DETOUR: 1 },
    });
    expect(result).not.toHaveProperty("origin");
    expect(result).not.toHaveProperty("ip");
    expect(result).not.toHaveProperty("userAgent");
  });

  it("검색 데이터가 없으면 비율은 0, 평균은 null로 반환한다", async () => {
    getAdminSearchMetricsMock.mockResolvedValue({
      completedCount: 0,
      zeroResultCount: 0,
      t3SearchCount: 0,
      averageDurationMs: null,
      warningSearchCount: 0,
      jsonFallbackSearchCount: 0,
      averageDisplayedCandidates: null,
      naviClickCount: 0,
      searchesWithNaviClick: 0,
      averageNaviRank: null,
      naviClicksByApp: [],
      naviClicksByTier: [],
    });

    const result = await getAdminDashboard({ range: "24h", now: NOW });

    expect(result.search).toEqual({
      completedCount: 0,
      zeroResultRate: 0,
      t3Rate: 0,
      averageDurationMs: null,
      warningRate: 0,
      jsonFallbackRate: 0,
      averageDisplayedCandidates: null,
    });
    expect(result.navi.clickRate).toBe(0);
  });

  it("30일 기간은 현재 시각에서 30일 전부터 집계한다", async () => {
    await getAdminDashboard({ range: "30d", now: NOW });

    expect(getAdminSearchMetricsMock).toHaveBeenCalledWith(new Date("2026-09-20T00:00:00.000Z"), undefined);
  });
});
