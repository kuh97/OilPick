import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminSessionMock, getAdminFeedbackListMock } = vi.hoisted(() => ({
  requireAdminSessionMock: vi.fn(),
  getAdminFeedbackListMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({
  requireAdminSession: requireAdminSessionMock,
}));
vi.mock("@/services/admin-feedback-service", () => ({
  getAdminFeedbackList: getAdminFeedbackListMock,
}));

import { GET } from "../route";

describe("GET /api/admin/feedback", () => {
  beforeEach(() => {
    requireAdminSessionMock.mockReset();
    getAdminFeedbackListMock.mockReset();
  });

  it("인증되지 않은 요청은 문의를 조회하지 않고 401을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(false);

    const response = await GET(new Request("https://example.com/api/admin/feedback"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "관리자 로그인이 필요합니다.",
    });
    expect(getAdminFeedbackListMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("허용된 상태 필터로 인증된 문의 목록을 조회한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminFeedbackListMock.mockResolvedValue({
      items: [
        {
          id: "feedback-1",
          email: "user@example.com",
          subject: "제목",
          content: "내용",
          feedbackSource: null,
          stationId: null,
          stationName: null,
          searchId: null,
          originName: null,
          destinationName: null,
          status: "NEW",
          createdAt: "2026-10-19T01:02:03.000Z",
          resolvedAt: null,
        },
      ],
      nextCursor: "next-cursor",
    });

    const response = await GET(new Request("https://example.com/api/admin/feedback?status=NEW"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: expect.any(Array),
      nextCursor: "next-cursor",
    });
    expect(getAdminFeedbackListMock).toHaveBeenCalledWith({ status: "NEW", cursor: undefined });
  });

  it("커서를 다음 페이지 조회에 그대로 전달한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminFeedbackListMock.mockResolvedValue({ items: [], nextCursor: null });

    const response = await GET(
      new Request("https://example.com/api/admin/feedback?status=NEW&cursor=opaque-cursor"),
    );

    expect(response.status).toBe(200);
    expect(getAdminFeedbackListMock).toHaveBeenCalledWith({
      status: "NEW",
      cursor: "opaque-cursor",
    });
  });

  it("잘못된 커서는 400을 반환한다", async () => {
    requireAdminSessionMock.mockResolvedValue(true);
    getAdminFeedbackListMock.mockRejectedValue(new Error("INVALID_ADMIN_FEEDBACK_CURSOR"));

    const response = await GET(
      new Request("https://example.com/api/admin/feedback?cursor=bad-cursor"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "문의 목록 커서가 올바르지 않습니다.",
    });
  });

  it("잘못된 상태 필터는 400이고 인증 확인보다 먼저 거부한다", async () => {
    const response = await GET(new Request("https://example.com/api/admin/feedback?status=WAITING"));

    expect(response.status).toBe(400);
    expect(requireAdminSessionMock).not.toHaveBeenCalled();
  });
});
