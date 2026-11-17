// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  HelpDrawer,
  OILPICK_FAQ_URL,
  OILPICK_PRIVACY_URL,
  OILPICK_TERMS_URL,
} from "../help-drawer";

async function openHelp() {
  render(<HelpDrawer stationId="station-1" searchId="search-1" />);
  fireEvent.click(screen.getByRole("button", { name: "도움말" }));
  await screen.findByRole("dialog");
}

describe("HelpDrawer", () => {
  it("도움말 메뉴에서 노션 FAQ를 새 탭으로 연다", async () => {
    await openHelp();

    const faqLink = screen.getByRole("link", { name: /자주 묻는 질문/ });

    expect(faqLink.getAttribute("href")).toBe(OILPICK_FAQ_URL);
    expect(faqLink.getAttribute("target")).toBe("_blank");
  });

  it("서비스 문의를 누르면 기존 문의 폼을 연다", async () => {
    await openHelp();

    fireEvent.click(screen.getByRole("button", { name: /서비스 문의/ }));

    expect(await screen.findByRole("heading", { name: "서비스 문의" })).toBeTruthy();
    expect(screen.getByLabelText("이메일")).toBeTruthy();
  });

  it("도움말 메뉴에서 이용약관과 개인정보 처리방침을 새 탭으로 연다", async () => {
    await openHelp();

    const termsLink = screen.getByRole("link", { name: "이용약관" });
    const privacyLink = screen.getByRole("link", { name: "개인정보 처리방침" });

    expect(termsLink.getAttribute("href")).toBe(OILPICK_TERMS_URL);
    expect(termsLink.getAttribute("target")).toBe("_blank");
    expect(privacyLink.getAttribute("href")).toBe(OILPICK_PRIVACY_URL);
    expect(privacyLink.getAttribute("target")).toBe("_blank");
  });
});
