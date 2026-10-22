// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpDrawer, OILPICK_FAQ_URL } from "../help-drawer";

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
});
