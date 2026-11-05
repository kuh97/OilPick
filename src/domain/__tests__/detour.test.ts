import { describe, expect, it } from "vitest";
import { computeDetourFromRoutes } from "../detour";

describe("computeDetourFromRoutes", () => {
  it("기본 경로 대비 실제 거리와 시간을 계산한다", () => {
    expect(
      computeDetourFromRoutes(
        { distanceM: 100_000, durationS: 5_000 },
        { distanceM: 101_250, durationS: 5_420 },
      ),
    ).toEqual({ distanceM: 1_250, durationS: 420 });
  });

  it("재탐색 결과가 더 짧으면 음수를 0으로 고정한다", () => {
    expect(
      computeDetourFromRoutes(
        { distanceM: 100_000, durationS: 5_000 },
        { distanceM: 99_500, durationS: 4_900 },
      ),
    ).toEqual({ distanceM: 0, durationS: 0 });
  });
});
