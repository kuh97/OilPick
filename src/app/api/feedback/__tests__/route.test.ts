import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitFeedbackMock, FeedbackRateLimitErrorMock } = vi.hoisted(() => {
  class FeedbackRateLimitErrorMock extends Error {}
  return { submitFeedbackMock: vi.fn(), FeedbackRateLimitErrorMock };
});

vi.mock("@/services/feedback-service", () => ({
  submitFeedback: (...args: unknown[]) => submitFeedbackMock(...args),
  FeedbackRateLimitError: FeedbackRateLimitErrorMock,
}));

import { POST } from "../route";

function request(body: unknown) {
  return new Request("https://example.com/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    email: " user@example.com ",
    subject: " 주유소 정보가 달라요 ",
    content: " 세차장이 있다고 표시되지만 현장에는 없어요. ",
    feedbackSource: "SEARCH",
    stationId: "station-1",
    stationName: "오일픽 주유소",
    searchId: "11111111-1111-4111-8111-111111111111",
    originName: "성남시청",
    destinationName: "춘천역",
  };
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    submitFeedbackMock.mockReset();
    submitFeedbackMock.mockResolvedValue(undefined);
  });

  it("필수값이 잘못되면 400이고 저장하지 않는다", async () => {
    const res = await POST(request({ email: "not-an-email", subject: "제목", content: "내용" }));

    expect(res.status).toBe(400);
    expect(submitFeedbackMock).not.toHaveBeenCalled();
  });

  it("입력을 정리한 뒤 문의를 저장하고 201을 반환한다", async () => {
    const res = await POST(request(validBody()));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(submitFeedbackMock).toHaveBeenCalledWith({
      email: "user@example.com",
      subject: "주유소 정보가 달라요",
      content: "세차장이 있다고 표시되지만 현장에는 없어요.",
      feedbackSource: "SEARCH",
      stationId: "station-1",
      stationName: "오일픽 주유소",
      searchId: "11111111-1111-4111-8111-111111111111",
      originName: "성남시청",
      destinationName: "춘천역",
    });
  });

  it("요청 제한에 걸리면 429를 반환한다", async () => {
    submitFeedbackMock.mockRejectedValueOnce(new FeedbackRateLimitErrorMock());

    const res = await POST(request(validBody()));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
      message: "문의 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("저장 실패 시 문의 내용을 응답이나 로그에 남기지 않는다", async () => {
    submitFeedbackMock.mockRejectedValueOnce(new Error("database error: user@example.com"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await POST(request(validBody()));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "문의 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(errorSpy).toHaveBeenCalledWith("[POST /api/feedback] 문의 저장 실패");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("user@example.com");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("세차장이");
    errorSpy.mockRestore();
  });
});
