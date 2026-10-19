import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminSessionMock, getAdminFeedbackCountsMock } = vi.hoisted(() => ({
  requireAdminSessionMock: vi.fn(),
  getAdminFeedbackCountsMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({
  requireAdminSession: requireAdminSessionMock,
}));
vi.mock("@/services/admin-feedback-service", () => ({
  getAdminFeedbackCounts: getAdminFeedbackCountsMock,
}));

import { GET } from "../route";

describe("GET /api/admin/feedback/counts", () => {
  beforeEach(() => {
    requireAdminSessionMock.mockReset();
    getAdminFeedbackCountsMock.mockReset();
  });

  it("인증되지 않은 요청은 건수를 조회하지 않고 401을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getAdminFeedbackCountsMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("인증된 요청은 상태별 전체 건수를 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminFeedbackCountsMock.mockResolvedValue({
      ALL: 10,
      NEW: 3,
      IN_PROGRESS: 2,
      RESOLVED: 5,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      counts: { ALL: 10, NEW: 3, IN_PROGRESS: 2, RESOLVED: 5 },
    });
  });
});
