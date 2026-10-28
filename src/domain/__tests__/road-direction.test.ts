import { describe, expect, it } from "vitest";
import {
  classifyRoadLinkDirections,
  headingDifferenceDegrees,
  headingRad,
  routeHeadingAtPoint,
} from "../road-direction";
import { projected } from "../types";

describe("road-direction", () => {
  it("링크 geometry의 시작점에서 끝점으로 방위각을 계산한다", () => {
    expect(headingRad(projected(0, 0), projected(10, 0))).toBeCloseTo(Math.PI / 2);
    expect(headingRad(projected(10, 0), projected(0, 0))).toBeCloseTo(-Math.PI / 2);
    expect(headingRad(projected(0, 0), projected(0, 0))).toBeNull();
  });

  it("주유소에 가장 가까운 경로 선분의 진행 방향을 선택한다", () => {
    const route = [projected(0, 0), projected(100, 0), projected(100, 100)];
    expect(routeHeadingAtPoint(projected(40, 5), route)).toBeCloseTo(Math.PI / 2);
    expect(routeHeadingAtPoint(projected(105, 60), route)).toBeCloseTo(0);
  });

  it("같은 방향 링크가 하나라도 있으면 후보를 보존한다", () => {
    const east = headingRad(projected(0, 0), projected(10, 0))!;
    const west = headingRad(projected(10, 0), projected(0, 0))!;
    expect(classifyRoadLinkDirections(east, [west])).toBe("OPPOSITE_DIRECTION");
    expect(classifyRoadLinkDirections(east, [west, east])).toBe("SAME_DIRECTION");
    expect(classifyRoadLinkDirections(null, [east])).toBe("UNKNOWN");
    expect(classifyRoadLinkDirections(east, [])).toBe("UNKNOWN");
  });

  it("방향 차이를 도 단위로 노출한다", () => {
    const north = headingRad(projected(0, 0), projected(0, 10))!;
    const east = headingRad(projected(0, 0), projected(10, 0))!;
    expect(headingDifferenceDegrees(north, east)).toBeCloseTo(90);
  });
});
