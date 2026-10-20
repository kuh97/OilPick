import { describe, expect, it, vi } from "vitest";
import type { Db } from "../client";
import { getAdminSearchMetrics } from "../admin-metrics";

describe("getAdminSearchMetrics", () => {
  it("기간 집계와 앱·티어별 내비 클릭을 숫자로 반환한다", async () => {
    const searchWhere = vi.fn().mockResolvedValue([{
      completedCount: "10",
      zeroResultCount: "2",
      t3SearchCount: 4,
      averageDurationMs: "1850.5",
      warningSearchCount: "1",
      jsonFallbackSearchCount: 3,
      averageDisplayedCandidates: "4.2",
    }]);
    const searchFrom = vi.fn(() => ({ where: searchWhere }));
    const naviWhere = vi.fn().mockResolvedValue([{
      naviClickCount: "7",
      searchesWithNaviClick: "5",
      averageNaviRank: "1.8",
    }]);
    const naviLeftJoin = vi.fn(() => ({ where: naviWhere }));
    const naviFrom = vi.fn(() => ({ leftJoin: naviLeftJoin }));
    const appGroupBy = vi.fn().mockResolvedValue([
      { app: "KAKAO", count: "4" },
      { app: "NAVER", count: 3 },
    ]);
    const appWhere = vi.fn(() => ({ groupBy: appGroupBy }));
    const appInnerJoin = vi.fn(() => ({ where: appWhere }));
    const appFrom = vi.fn(() => ({ innerJoin: appInnerJoin }));
    const tierGroupBy = vi.fn().mockResolvedValue([
      { tier: "ON_ROUTE", count: "6" },
      { tier: "DETOUR", count: 1 },
    ]);
    const tierWhere = vi.fn(() => ({ groupBy: tierGroupBy }));
    const tierInnerJoin = vi.fn(() => ({ where: tierWhere }));
    const tierFrom = vi.fn(() => ({ innerJoin: tierInnerJoin }));
    const select = vi.fn()
      .mockReturnValueOnce({ from: searchFrom })
      .mockReturnValueOnce({ from: naviFrom })
      .mockReturnValueOnce({ from: appFrom })
      .mockReturnValueOnce({ from: tierFrom });

    await expect(
      getAdminSearchMetrics(new Date("2026-10-20T00:00:00.000Z"), { select } as unknown as Db),
    ).resolves.toEqual({
      completedCount: 10,
      zeroResultCount: 2,
      t3SearchCount: 4,
      averageDurationMs: 1850.5,
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
      naviClicksByTier: [
        { tier: "ON_ROUTE", count: 6 },
        { tier: "DETOUR", count: 1 },
      ],
    });
  });
});
