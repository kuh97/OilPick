// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFeedbackList } from "../admin-feedback-list";

const deleteFeedbackMock = vi.fn();

vi.mock("@/lib/api/useAdminFeedback", () => ({
  useAdminFeedback: () => ({
    items: [
      {
        id: "feedback-1",
        email: "user@example.com",
        subject: "문의 제목",
        content: "문의 내용",
        stationId: null,
        searchId: null,
        status: "NEW",
        createdAt: "2026-10-19T01:02:03.000Z",
        resolvedAt: null,
      },
    ],
    isLoading: false,
    error: null,
    hasNextPage: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("@/lib/api/useAdminFeedbackCounts", () => ({
  useAdminFeedbackCounts: () => ({ counts: { ALL: 1, NEW: 1, IN_PROGRESS: 0, RESOLVED: 0 } }),
}));

vi.mock("@/lib/api/useAdminFeedbackStatus", () => ({
  useAdminFeedbackStatus: () => ({
    updateStatus: vi.fn(),
    isUpdating: false,
    updatingId: null,
    error: null,
  }),
}));

vi.mock("@/lib/api/useAdminFeedbackDelete", () => ({
  useAdminFeedbackDelete: () => ({
    deleteFeedback: deleteFeedbackMock,
    isDeleting: false,
    deletingId: null,
    error: null,
  }),
}));

describe("AdminFeedbackList", () => {
  beforeEach(() => {
    deleteFeedbackMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("이메일·시간, 제목, 내용 순서로 표시하고 문의별 삭제를 요청한다", () => {
    render(<AdminFeedbackList />);

    const card = screen.getByRole("article");
    const cardText = card.textContent ?? "";
    expect(cardText.indexOf("user@example.com")).toBeLessThan(cardText.indexOf("문의 제목"));
    expect(cardText.indexOf("문의 제목")).toBeLessThan(cardText.indexOf("문의 내용"));

    fireEvent.click(screen.getByRole("button", { name: "문의 제목 삭제" }));

    expect(window.confirm).toHaveBeenCalledWith("이 문의를 삭제할까요? 삭제 후 복구할 수 없습니다.");
    expect(deleteFeedbackMock).toHaveBeenCalledWith({ id: "feedback-1" });
  });
});
