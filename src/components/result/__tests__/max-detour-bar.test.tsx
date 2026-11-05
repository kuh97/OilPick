// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetourDistanceBar, DETOUR_DISTANCE_STEPS_KM } from "../max-detour-bar";

describe("허용 우회 거리 선택지", () => {
  it("3·5·10·15km로 고정한다", () => {
    expect(DETOUR_DISTANCE_STEPS_KM).toEqual([3, 5, 10, 15]);
  });
});

describe("DetourDistanceBar — PRODUCT.md §5.3 ⑥", () => {
  it("정해진 거리 선택지만 렌더링한다", () => {
    render(<DetourDistanceBar value={5} onChange={() => {}} />);
    for (const step of [3, 5, 10, 15]) {
      expect(screen.getByRole("radio", { name: String(step) })).toBeTruthy();
    }
  });

  it("현재 값 세그먼트만 aria-checked=true", () => {
    render(<DetourDistanceBar value={10} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "10" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "5" }).getAttribute("aria-checked")).toBe("false");
  });

  it("세그먼트를 누르면 해당 거리(km)로 onChange 한다", () => {
    const onChange = vi.fn();
    render(<DetourDistanceBar value={5} onChange={onChange} />);
    screen.getByRole("radio", { name: "10" }).click();
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
