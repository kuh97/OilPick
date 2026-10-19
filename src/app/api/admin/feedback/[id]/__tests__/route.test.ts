import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminSessionMock, updateAdminFeedbackStatusMock } = vi.hoisted(() => ({
  requireAdminSessionMock: vi.fn(),
  updateAdminFeedbackStatusMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({
  requireAdminSession: requireAdminSessionMock,
}));
vi.mock("@/services/admin-feedback-service", () => ({
  updateAdminFeedbackStatus: updateAdminFeedbackStatusMock,
}));

import { PATCH } from "../route";

function params(id = "feedback-1") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/feedback/:id", () => {
  beforeEach(() => {
    requireAdminSessionMock.mockReset();
    updateAdminFeedbackStatusMock.mockReset();
  });

  it("인증되지 않은 요청은 상태를 변경하지 않고 401을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(false);

    const response = await PATCH(
      new Request("https://example.com/api/admin/feedback/feedback-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "RESOLVED" }),
      }),
      params(),
    );

    expect(response.status).toBe(401);
    expect(updateAdminFeedbackStatusMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("잘못된 상태는 400으로 거부한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);

    const response = await PATCH(
      new Request("https://example.com/api/admin/feedback/feedback-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "WAITING" }),
      }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(updateAdminFeedbackStatusMock).not.toHaveBeenCalled();
  });

  it("인증된 요청은 문의 상태를 변경한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    updateAdminFeedbackStatusMock.mockResolvedValue({
      id: "feedback-1",
      status: "RESOLVED",
    });

    const response = await PATCH(
      new Request("https://example.com/api/admin/feedback/feedback-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "RESOLVED" }),
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      item: { id: "feedback-1", status: "RESOLVED" },
    });
    expect(updateAdminFeedbackStatusMock).toHaveBeenCalledWith({
      id: "feedback-1",
      status: "RESOLVED",
    });
  });

  it("없는 문의는 404를 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    updateAdminFeedbackStatusMock.mockResolvedValue(null);

    const response = await PATCH(
      new Request("https://example.com/api/admin/feedback/unknown", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      }),
      params("unknown"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "문의를 찾을 수 없습니다.",
    });
  });
});
