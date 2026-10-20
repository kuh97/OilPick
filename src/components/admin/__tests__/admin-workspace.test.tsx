// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminWorkspace } from "../admin-workspace";

vi.mock("@/components/admin/admin-dashboard", () => ({
  AdminDashboard: () => <div>운영 대시보드 내용</div>,
}));
vi.mock("@/components/admin/admin-feedback-list", () => ({
  AdminFeedbackList: () => <div>서비스 문의 내용</div>,
}));

describe("AdminWorkspace", () => {
  it("운영 대시보드와 서비스 문의를 한 번에 하나만 보여준다", () => {
    render(<AdminWorkspace />);

    expect(screen.getByText("운영 대시보드 내용")).toBeTruthy();
    expect(screen.queryByText("서비스 문의 내용")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "서비스 문의" }));

    expect(screen.queryByText("운영 대시보드 내용")).toBeNull();
    expect(screen.getByText("서비스 문의 내용")).toBeTruthy();
  });
});
