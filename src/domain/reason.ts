/**
 * 추천 이유 문구 생성 — 템플릿 기반, AI 미사용
 * PRODUCT.md §5.4 · AGENTS.md §4
 *
 * 조건을 위에서부터 검사해 처음 맞는 것 하나를 반환합니다.
 */

import { distanceMToKm, durationSToMin } from "./pricing";
import type { Tier, Mode } from "./types";

export interface ReasonInput {
  rank: number;           // 1-indexed 순위
  tier: Tier;
  priceRefWon: number;
  priceStationWon: number;
  priceRankAmongAll: number;    // 전체 후보 중 가격 순위 (1-indexed)
  totalCandidates: number;
  detourDistanceM: number;
  detourDurationS: number;
  hasFacilityMatch: boolean;    // 필터 조건 매칭 여부
  mode: Mode;
}

const MODE_LABEL: Record<Mode, string> = {
  balanced: "균형",
  minCost: "비용",
  minDistance: "거리",
};

/**
 * 추천 이유 문구 생성.
 * PRODUCT.md §5.4 템플릿 6분기.
 */
export function buildReason(input: ReasonInput): string {
  const {
    rank,
    tier,
    priceRefWon,
    priceStationWon,
    priceRankAmongAll,
    detourDistanceM,
    detourDurationS,
    hasFacilityMatch,
    mode,
  } = input;

  const priceDiff = priceRefWon - priceStationWon;
  const detourKm = distanceMToKm(detourDistanceM);
  const detourMin = durationSToMin(detourDurationS);

  // 1위 & 우회
  if (rank === 1 && tier === "DETOUR") {
    return `${detourKm}km 우회하지만 리터당 ${priceDiff}원 저렴합니다.`;
  }

  // 1위 & 경로상
  if (rank === 1 && tier === "ON_ROUTE") {
    return `가는 길에 들를 수 있으면서 가격도 ${priceRankAmongAll}번째로 저렴합니다.`;
  }

  // 최저가 (가격 1위)
  if (priceRankAmongAll === 1) {
    if (detourDistanceM > 0) {
      return `이 경로에서 가장 저렴합니다. 다만 ${detourKm}km 우회가 필요합니다.`;
    }
    return "이 경로에서 가장 저렴합니다.";
  }

  // 경로상 — 실측 ΔT 기준 (§6.4)
  if (tier === "ON_ROUTE" && detourMin === 0) {
    return "가는 길에 그대로 들를 수 있습니다. 우회 없음.";
  }
  if (tier === "ON_ROUTE") {
    return `가는 길에 들를 수 있습니다. ${detourMin}분만 더 걸립니다.`;
  }

  // 필터 조건 매칭
  if (hasFacilityMatch) {
    return `조건에 맞는 곳 중 ${MODE_LABEL[mode]} 기준으로 좋습니다.`;
  }

  // 그 외
  return "가격과 우회 거리의 균형이 좋습니다.";
}
