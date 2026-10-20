import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendFeedbackNotification } from "../resend";

const INPUT = {
  email: "user@example.com",
  subject: "<제목>",
  content: "첫 줄\n<script>alert('x')</script>",
  feedbackSource: "SEARCH" as const,
  stationId: "station-1",
  stationName: "오일픽 주유소",
  searchId: null,
  originName: "성남시청",
  destinationName: "춘천역",
};

describe("sendFeedbackNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("필수 설정이 없으면 외부 요청을 보내지 않는다", async () => {
    const fetchFn = vi.fn();

    await sendFeedbackNotification(INPUT, { fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("문의 내용을 Resend 관리자 알림으로 보내고 회신 주소를 문의자로 설정한다", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await sendFeedbackNotification(INPUT, {
      fetchFn,
      apiKey: "re_test",
      notifyEmail: "owner@example.com",
      fromEmail: "OilPick <noreply@example.com>",
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, request] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      Authorization: "Bearer re_test",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "OilPick <noreply@example.com>",
      to: ["owner@example.com"],
      reply_to: "user@example.com",
      subject: "[OilPick 문의] <제목>",
    });
    expect(body.text).toContain(INPUT.content);
    expect(body.text).toContain("경로: 성남시청 → 춘천역");
    expect(body.text).toContain("문의 경로: 검색");
    expect(body.text).toContain("주유소: 오일픽 주유소");
    expect(body.html).toContain("&lt;제목&gt;");
    expect(body.html).not.toContain("<script>");
  });

  it("Resend 실패를 호출자에게 알린다", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      sendFeedbackNotification(INPUT, {
        fetchFn,
        apiKey: "re_test",
        notifyEmail: "owner@example.com",
        fromEmail: "noreply@example.com",
      }),
    ).rejects.toThrow("Resend email request failed: 401");
  });
});
