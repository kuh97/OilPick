import type { BaseRoute } from "./types";

/**
 * 기본 경로와 경유 경로의 실제 차이를 계산합니다.
 * 경유 경로가 재탐색 결과 더 짧아지는 경우에도 음수를 노출하지 않습니다.
 */
export function computeDetourFromRoutes(
  baseRoute: Pick<BaseRoute, "distanceM" | "durationS">,
  viaRoute: Pick<BaseRoute, "distanceM" | "durationS">,
): { distanceM: number; durationS: number } {
  return {
    distanceM: Math.max(0, viaRoute.distanceM - baseRoute.distanceM),
    durationS: Math.max(0, viaRoute.durationS - baseRoute.durationS),
  };
}
