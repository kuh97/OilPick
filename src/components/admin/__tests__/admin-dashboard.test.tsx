// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDashboard } from "../admin-dashboard";

const { useAdminDashboardMock, useAdminFeedbackCountsMock } = vi.hoisted(() => ({
  useAdminDashboardMock: vi.fn(),
  useAdminFeedbackCountsMock: vi.fn(),
}));

vi.mock("@/lib/api/useAdminDashboard", () => ({
  useAdminDashboard: useAdminDashboardMock,
}));
vi.mock("@/lib/api/useAdminFeedbackCounts", () => ({
  useAdminFeedbackCounts: useAdminFeedbackCountsMock,
}));

const dashboard = {
  range: "24h" as const,
  period: { since: "2026-10-19T00:00:00.000Z", until: "2026-10-20T00:00:00.000Z" },
  priceData: {
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
  },
  search: {
    completedCount: 120,
    zeroResultRate: 0.05,
    t3Rate: 0.32,
    averageDurationMs: 1_840,
    warningRate: 0.02,
    jsonFallbackRate: 0.08,
    averageDisplayedCandidates: 4.1,
  },
  navi: {
    clickCount: 48,
    clickRate: 0.35,
    averageRank: 1.8,
    byApp: { KAKAO: 22, NAVER: 18, TMAP: 8 },
    byTier: { ON_ROUTE: 39, DETOUR: 9 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAdminDashboardMock.mockReturnValue({ dashboard, isLoading: false, isFetching: false, error: null, retry: vi.fn() });
  useAdminFeedbackCountsMock.mockReturnValue({ counts: { ALL: 10, NEW: 3, IN_PROGRESS: 2, RESOLVED: 5 } });
});

describe("AdminDashboard", () => {
  it("운영·검색·내비 지표를 표시한다", () => {
    render(<AdminDashboard />);

    expect(screen.getByRole("heading", { name: "운영 대시보드" })).toBeTruthy();
    expect(screen.getAllByText("2026-10-19")).toHaveLength(2);
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
    expect(screen.getByText("카카오맵")).toBeTruthy();
    expect(screen.getByText("경로상")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("기간 버튼을 누르면 선택된 기간으로 지표 훅을 다시 사용한다", () => {
    render(<AdminDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "7일" }));

    expect(screen.getByRole("button", { name: "7일" }).getAttribute("aria-pressed")).toBe("true");
    expect(useAdminDashboardMock).toHaveBeenLastCalledWith("7d");
  });

  it("데이터가 없으면 평균과 비율을 대시로 표시한다", () => {
    useAdminDashboardMock.mockReturnValue({
      dashboard: {
        ...dashboard,
        search: {
          ...dashboard.search,
          completedCount: 0,
          zeroResultRate: 0,
          t3Rate: 0,
          averageDurationMs: null,
          warningRate: 0,
          jsonFallbackRate: 0,
          averageDisplayedCandidates: null,
        },
        navi: { ...dashboard.navi, clickRate: 0, averageRank: null },
      },
      isLoading: false,
      isFetching: false,
      error: null,
      retry: vi.fn(),
    });

    render(<AdminDashboard />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
