/**
 * 결과 화면에서 "모드 탭 전환 시 API 재호출 0회"·"연비·주유량 수정 시 즉시 재계산"
 * (ARCHITECTURE.md §10 Phase 9 완료 기준)을 만족시키는 클라이언트 재계산.
 *
 * domain/pricing.ts는 의존성이 0인 순수 함수라 서버가 쓴 것과 완전히 동일한 계산을
 * 브라우저에서도 그대로 돌릴 수 있다 — 재요청 없이 새 vehicle 가정으로 다시 계산한다.
 * `reason`(추천 이유 문구)은 재생성하지 않는다 — priceRankAmongAll·hasFacilityMatch
 * 등 문구 생성에 필요한 입력이 wire SearchResult에 없어, 검색 시점의 문구를 그대로 둔다.
 */

import {
  netSaving,
  totalCost,
  computeScores,
  scoreByMode,
} from "@/domain/pricing";
import type { WireCandidate, WireVehicle, Mode } from "@/app/api/_lib/types";

export function recomputeCandidate(
  candidate: WireCandidate,
  vehicle: WireVehicle,
  referencePrice: number | null,
): WireCandidate {
  const args = {
    priceStationWon: candidate.price,
    refuelAmountL: vehicle.refuelAmount,
    detourDistanceM: candidate.detour.distanceM,
    efficiencyKmPerL: vehicle.efficiency,
  };
  const estimatedCost = totalCost(args);
  const scores = computeScores({
    ...args,
    detourDurationS: candidate.detour.durationS,
    timeValuePerMin: vehicle.timeValue,
  });
  const netSavingWon =
    referencePrice != null
      ? netSaving({ ...args, priceRefWon: referencePrice })
      : candidate.netSaving;

  return { ...candidate, estimatedCost, scores, netSaving: netSavingWon };
}

/**
 * 재계산 + 모드 기준 재정렬까지 한 번에. referencePrice가 없으면(A14) 가격순.
 *
 * 서버(`recommendation-service.finalizeCandidates`)와 **같은 정렬 규칙**이어야 한다.
 * 현재 검색 결과는 모두 `precise:false`로 시작하지만, 이미 실측값을 가진 호출자가
 * 이 함수를 재사용할 때도 실측 후보 우선 정렬을 유지한다.
 */
export function recomputeAndSort(
  candidates: WireCandidate[],
  vehicle: WireVehicle,
  referencePrice: number | null,
  mode: Mode,
): WireCandidate[] {
  const recomputed = candidates.map((c) =>
    recomputeCandidate(c, vehicle, referencePrice),
  );
  return [...recomputed].sort((a, b) => {
    // 실측으로 확인된 경로상 후보가 함께 들어온 경우에만 비용과 무관하게 먼저 보여준다.
    const aOnRoute = a.tier === "ON_ROUTE" && a.detour.precise;
    const bOnRoute = b.tier === "ON_ROUTE" && b.detour.precise;
    if (aOnRoute !== bOnRoute) return Number(bOnRoute) - Number(aOnRoute);
    const byPrecise = Number(b.detour.precise) - Number(a.detour.precise);
    if (byPrecise !== 0) return byPrecise;
    return referencePrice == null
      ? a.price - b.price
      : scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
  });
}
