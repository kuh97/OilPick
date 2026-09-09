// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaxDetourBar, MAX_DETOUR_STEPS } from "../max-detour-bar";

describe("MaxDetourBar — PRODUCT.md §5.3 ⑥", () => {
  it("5분 단위 0~30분 세그먼트를 모두 렌더링한다", () => {
    render(<MaxDetourBar value={20} onChange={() => {}} />);
    for (const step of MAX_DETOUR_STEPS) {
      expect(screen.getByRole("radio", { name: String(step) })).toBeTruthy();
    }
  });

  it("현재 값 세그먼트만 aria-checked=true", () => {
    render(<MaxDetourBar value={15} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "15" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "20" }).getAttribute("aria-checked")).toBe("false");
  });

  it("세그먼트를 누르면 해당 분(minute)으로 onChange 한다", () => {
    const onChange = vi.fn();
    render(<MaxDetourBar value={20} onChange={onChange} />);
    screen.getByRole("radio", { name: "10" }).click();
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("값이 30을 넘으면 30분 세그먼트가 활성이다", () => {
    render(<MaxDetourBar value={42} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "30" }).getAttribute("aria-checked")).toBe("true");
  });
});
