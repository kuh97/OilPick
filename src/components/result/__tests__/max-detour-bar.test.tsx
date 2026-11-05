// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, screen } from "@testing-library/react";
import { DetourDistanceBar, DETOUR_DISTANCE_STEPS_KM } from "../max-detour-bar";

describe("허용 우회 거리 선택지", () => {
  it("3·5·10·15km로 고정한다", () => {
    expect(DETOUR_DISTANCE_STEPS_KM).toEqual([3, 5, 10, 15]);
  });
});

describe("DetourDistanceBar — PRODUCT.md §5.3 ⑥", () => {
  it("정해진 거리 선택지만 2x2 버튼으로 렌더링한다", async () => {
    render(<DetourDistanceBar value={5} onChange={() => {}} />);
    await act(async () => {
      screen.getByRole("button", { name: /허용 우회 거리.*5km 이내/ }).click();
    });
    for (const step of [3, 5, 10, 15]) {
      expect(
        await screen.findByRole("button", { name: `${step} km 이내` }),
      ).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "5 km 이내" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "허용 우회 거리 닫기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });

  it("시트에서 값을 바꾸고 적용하면 해당 거리(km)로 onChange 한다", async () => {
    const onChange = vi.fn();
    render(<DetourDistanceBar value={5} onChange={onChange} />);
    await act(async () => {
      screen.getByRole("button", { name: /허용 우회 거리.*5km 이내/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "10 km 이내" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "적용하고 다시 검색" }).click();
    });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
