import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminSessionMock, getAdminDashboardMock } = vi.hoisted(() => ({
  requireAdminSessionMock: vi.fn(),
  getAdminDashboardMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({ requireAdminSession: requireAdminSessionMock }));
vi.mock("@/services/admin-dashboard-service", () => ({ getAdminDashboard: getAdminDashboardMock }));

import { GET } from "../route";

describe("GET /api/admin/dashboard", () => {
  beforeEach(() => {
    requireAdminSessionMock.mockReset();
    getAdminDashboardMock.mockReset();
  });

  it("인증되지 않은 요청은 지표를 조회하지 않고 401을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(false);

    const response = await GET(new Request("https://example.com/api/admin/dashboard?range=7d"));

    expect(response.status).toBe(401);
    expect(getAdminDashboardMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("잘못된 기간은 인증 확인보다 먼저 400을 반환한다", async () => {
    const response = await GET(new Request("https://example.com/api/admin/dashboard?range=90d"));

    expect(response.status).toBe(400);
    expect(requireAdminSessionMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("30일 기간을 인증된 요청에서 서비스에 넘긴다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminDashboardMock.mockResolvedValue({ range: "30d", search: { completedCount: 0 } });

    const response = await GET(new Request("https://example.com/api/admin/dashboard?range=30d"));

    expect(response.status).toBe(200);
    expect(getAdminDashboardMock).toHaveBeenCalledWith({ range: "30d" });
  });

  it("인증된 요청은 선택한 기간을 서비스에 넘기고 no-store 응답을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminDashboardMock.mockResolvedValue({ range: "7d", search: { completedCount: 0 } });

    const response = await GET(new Request("https://example.com/api/admin/dashboard?range=7d"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ range: "7d", search: { completedCount: 0 } });
    expect(getAdminDashboardMock).toHaveBeenCalledWith({ range: "7d" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("DB 오류는 내부 내용을 노출하지 않고 503을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminDashboardMock.mockRejectedValue(new Error("DATABASE_URL leaked"));

    const response = await GET(new Request("https://example.com/api/admin/dashboard"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "ADMIN_DATA_UNAVAILABLE",
      message: "운영 지표를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});
