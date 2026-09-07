// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpansionBanner } from "../expansion-banner";

describe("ExpansionBanner — AGENTS.md §6 제거 금지", () => {
  it("triggered면 우회 고지를 보여준다 (연료가 주유소일 때)", () => {
    render(<ExpansionBanner expansion={{ triggered: true, finalRadiusM: 7000 }} fuel="GASOLINE" />);
    expect(screen.getByText(/조건에 맞는 주유소를 충분히 찾지 못해 7km까지 넓혀 찾았어요/)).toBeTruthy();
  });

  it("triggered면 우회 고지를 보여준다 (연료가 LPG일 때는 충전소로 표기)", () => {
    render(<ExpansionBanner expansion={{ triggered: true, finalRadiusM: 7000 }} fuel="LPG" />);
    expect(screen.getByText(/조건에 맞는 충전소를 충분히 찾지 못해 7km까지 넓혀 찾았어요/)).toBeTruthy();
  });

  it("최종 목록에 T3가 없으면(triggered=false) 아무 배너도 렌더링하지 않는다", () => {
    const { container } = render(
      <ExpansionBanner expansion={{ triggered: false, finalRadiusM: 3000 }} fuel="GASOLINE" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
