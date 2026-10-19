// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedbackDialog } from "../feedback-dialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDialog() {
  render(<FeedbackDialog stationId="station-1" searchId="11111111-1111-4111-8111-111111111111" />);
  fireEvent.click(screen.getByRole("button", { name: "서비스 문의" }));
  await screen.findByRole("dialog");
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "user@example.com" } });
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "시설 정보 오류" } });
  fireEvent.change(screen.getByLabelText("내용"), { target: { value: "세차장이 실제와 달라요." } });
}

describe("FeedbackDialog", () => {
  it("문의 폼을 열고 주유소·검색 정보를 함께 전송한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await openDialog();
    fillForm();

    const form = screen.getByRole("button", { name: "문의 보내기" }).closest("form");
    if (!form) throw new Error("문의 폼을 찾을 수 없습니다.");
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole("heading", { name: "문의가 접수됐어요" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "user@example.com",
          subject: "시설 정보 오류",
          content: "세차장이 실제와 달라요.",
          stationId: "station-1",
          searchId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("공백만 입력하면 요청하지 않고 안내한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await openDialog();

    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "   " } });
    const form = screen.getByRole("button", { name: "문의 보내기" }).closest("form");
    if (!form) throw new Error("문의 폼을 찾을 수 없습니다.");
    fireEvent.submit(form);

    expect(screen.getByRole("alert").textContent).toContain("모두 입력해주세요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API 오류를 화면에 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "RATE_LIMITED", message: "잠시 후 다시 시도해주세요." }), { status: 429 }),
      ),
    );
    await openDialog();
    fillForm();

    const form = screen.getByRole("button", { name: "문의 보내기" }).closest("form");
    if (!form) throw new Error("문의 폼을 찾을 수 없습니다.");
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("잠시 후 다시 시도해주세요."));
  });

  it("문의 창을 닫았다가 다시 열면 입력 내용을 초기화한다", async () => {
    await openDialog();
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "서비스 문의" }));
    await screen.findByRole("dialog");

    expect((screen.getByLabelText("이메일") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("내용") as HTMLTextAreaElement).value).toBe("");
  });
});
