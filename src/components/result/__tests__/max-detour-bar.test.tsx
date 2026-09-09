// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaxDetourBar, maxDetourSteps } from "../max-detour-bar";

describe("maxDetourSteps — 상한은 경로에서 유도한다 (§5.3 ⑥)", () => {
  it("상한까지 5분 단위로 만든다", () => {
    expect(maxDetourSteps(20)).toEqual([5, 10, 15, 20]);
  });

  it("긴 경로는 더 많은 칸을 만든다", () => {
    expect(maxDetourSteps(45)).toHaveLength(9);
  });

  it("상한이 5분 미만이어도 최소 한 칸은 남긴다", () => {
    expect(maxDetourSteps(0)).toEqual([5]);
  });
});

describe("MaxDetourBar — PRODUCT.md §5.3 ⑥", () => {
  it("상한까지의 세그먼트만 렌더링한다 — 넘는 칸은 만들지 않는다", () => {
    render(<MaxDetourBar value={20} ceilingMinutes={20} onChange={() => {}} />);
    for (const step of [5, 10, 15, 20]) {
      expect(screen.getByRole("radio", { name: String(step) })).toBeTruthy();
    }
    // 짧은 경로에서 25·30은 눌러도 아무 일이 없는 죽은 UI라 아예 만들지 않는다.
    expect(screen.queryByRole("radio", { name: "25" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "30" })).toBeNull();
  });

  it("현재 값 세그먼트만 aria-checked=true", () => {
    render(<MaxDetourBar value={15} ceilingMinutes={30} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "15" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "20" }).getAttribute("aria-checked")).toBe("false");
  });

  it("세그먼트를 누르면 해당 분(minute)으로 onChange 한다", () => {
    const onChange = vi.fn();
    render(<MaxDetourBar value={20} ceilingMinutes={30} onChange={onChange} />);
    screen.getByRole("radio", { name: "10" }).click();
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("값이 상한을 넘으면 상한 세그먼트가 활성이다", () => {
    render(<MaxDetourBar value={42} ceilingMinutes={20} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "20" }).getAttribute("aria-checked")).toBe("true");
  });
});
