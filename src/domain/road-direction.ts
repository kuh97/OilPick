import type { ProjectedPoint } from "./types";
import { pointToSegmentDistanceM } from "./geo";

/** 도로 링크와 기본 경로의 진행 방향을 비교한 보수적 분류. */
export type RoadAccessDirection =
  | "SAME_DIRECTION"
  | "OPPOSITE_DIRECTION"
  | "UNKNOWN";

/** 투영좌표에서 북쪽을 0으로 하는 방위각(rad)을 반환합니다. */
export function headingRad(a: ProjectedPoint, b: ProjectedPoint): number | null {
  if (a.x === b.x && a.y === b.y) return null;
  return Math.atan2(b.x - a.x, b.y - a.y);
}

function angularDifferenceRad(a: number, b: number): number {
  const fullTurn = Math.PI * 2;
  const raw = Math.abs(a - b) % fullTurn;
  return raw > Math.PI ? fullTurn - raw : raw;
}

/** 주유소에 가장 가까운 기본 경로 선분의 진행 방향을 구합니다. */
export function routeHeadingAtPoint(
  point: ProjectedPoint,
  polyline: readonly ProjectedPoint[],
): number | null {
  if (polyline.length < 2) return null;

  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestHeading: number | null = null;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const start = polyline[i];
    const end = polyline[i + 1];
    const segmentHeading = headingRad(start, end);
    if (segmentHeading == null) continue;
    const segmentDistance = pointToSegmentDistanceM(point, start, end);
    if (segmentDistance < nearestDistance) {
      nearestDistance = segmentDistance;
      nearestHeading = segmentHeading;
    }
  }
  return nearestHeading;
}

/**
 * 링크가 하나라도 진행 방향 반원 안에 있으면 보존합니다.
 * 링크가 없거나 경로 방향을 계산할 수 없을 때만 UNKNOWN이며, UNKNOWN은 제거하지 않습니다.
 */
export function classifyRoadLinkDirections(
  routeHeading: number | null,
  linkHeadings: readonly number[],
): RoadAccessDirection {
  if (routeHeading == null || linkHeadings.length === 0) return "UNKNOWN";
  if (
    linkHeadings.some(
      (linkHeading) =>
        angularDifferenceRad(routeHeading, linkHeading) <= Math.PI / 2,
    )
  ) {
    return "SAME_DIRECTION";
  }
  return "OPPOSITE_DIRECTION";
}

/** 테스트와 로깅에서 방향 비교값을 읽기 쉽게 쓰기 위한 도우미입니다. */
export function headingDifferenceDegrees(a: number, b: number): number {
  return (angularDifferenceRad(a, b) * 180) / Math.PI;
}
