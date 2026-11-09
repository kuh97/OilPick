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
import type {
  WireCandidate,
  WireFilters,
  WireVehicle,
  Mode,
} from "@/app/api/_lib/types";

/**
 * 검색 결과를 다시 요청하지 않고 화면에 표시할 후보만 좁힌다.
 * 허용 우회 거리는 서버 검색 입력이므로 이 함수에서 다루지 않는다.
 */
export function filterCandidates(
  candidates: WireCandidate[],
  filters: WireFilters,
): WireCandidate[] {
  return candidates.filter((candidate) => {
    if (filters.kpetroOnly && !candidate.kpetro) return false;
    if (filters.selfOnly && candidate.isSelf !== true) return false;
    if (
      filters.brands.length > 0 &&
      !filters.brands.includes(candidate.brand)
    ) {
      return false;
    }
    if (
      filters.facilities.includes("CAR_WASH") &&
      !candidate.facilities.carWash
    ) {
      return false;
    }
    if (
      filters.facilities.includes("MAINTENANCE") &&
      !candidate.facilities.maintenance
    ) {
      return false;
    }
    if (filters.facilities.includes("CVS") && !candidate.facilities.cvs) {
      return false;
    }
    return true;
  });
}

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
 * 경로상·우회 티어는 배지로만 표시하고, 전체 후보를 선택한 모드 점수로 정렬한다.
 * 현재 검색 결과는 모두 `precise:false`로 시작하지만, 점수가 같을 때는 이미 Kakao로
 * 확인된 후보를 안정적인 보조 기준으로 먼저 보여준다.
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
    const byMode =
      referencePrice == null
        ? a.price - b.price
        : scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
    if (byMode !== 0) return byMode;
    const byPrecise = Number(b.detour.precise) - Number(a.detour.precise);
    if (byPrecise !== 0) return byPrecise;
    return a.id.localeCompare(b.id);
  });
}
