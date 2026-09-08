/**
 * 결과 화면에서 "모드 탭 전환 시 API 재호출 0회"·"연비·주유량 수정 시 즉시 재계산"
 * (ARCHITECTURE.md §10 Phase 9 완료 기준)을 만족시키는 클라이언트 재계산.
 *
 * domain/pricing.ts는 의존성이 0인 순수 함수라 서버가 쓴 것과 완전히 동일한 계산을
 * 브라우저에서도 그대로 돌릴 수 있다 — 재요청 없이 새 vehicle 가정으로 다시 계산한다.
 * `reason`(추천 이유 문구)은 재생성하지 않는다 — priceRankAmongAll·hasFacilityMatch
 * 등 문구 생성에 필요한 입력이 wire SearchResult에 없어, 검색 시점의 문구를 그대로 둔다.
 */

import { netSaving, totalCost, computeScores, scoreByMode } from "@/domain/pricing";
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
  const scores = computeScores({ ...args, detourDurationS: candidate.detour.durationS, timeValuePerMin: vehicle.timeValue });
  const netSavingWon =
    referencePrice != null ? netSaving({ ...args, priceRefWon: referencePrice }) : candidate.netSaving;

  return { ...candidate, estimatedCost, scores, netSaving: netSavingWon };
}

/**
 * 재계산 + 모드 기준 재정렬까지 한 번에. referencePrice가 없으면(A14) 가격순.
 *
 * 서버(`recommendation-service.finalizeCandidates`)와 **같은 정렬 규칙**이어야 한다 —
 * 실측군(`detour.precise`)이 추정군보다 항상 위. 여기서만 빠뜨리면 사용자가 모드 탭을
 * 누르는 순간 목록이 다시 추정치 우위로 뒤집힌다 (AGENTS.md §5 불변식 4).
 */
export function recomputeAndSort(
  candidates: WireCandidate[],
  vehicle: WireVehicle,
  referencePrice: number | null,
  mode: Mode,
): WireCandidate[] {
  const recomputed = candidates.map((c) => recomputeCandidate(c, vehicle, referencePrice));
  return [...recomputed].sort((a, b) => {
    const byPrecise = Number(b.detour.precise) - Number(a.detour.precise);
    if (byPrecise !== 0) return byPrecise;
    return referencePrice == null
      ? a.price - b.price
      : scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
  });
}

/**
 * "최대 우회 시간" 사용자 취향 필터 — PRODUCT.md §5.2.
 *
 * 서버의 `SHORT_ROUTE_DETOUR_TIME_CAP_S`(20분, domain/pricing.exceedsDetourCap)는
 * "이 이상은 아예 같은 여정이 아니다"라는 **기술적 하한**이라 사용자가 못 바꾼다.
 * 이건 그 안에서 "나는 몇 분까지만 돌아가겠다"는 **개인 취향**이다 — 재요청 없이
 * 이미 받은 후보 목록(전부 실측 완료, §7.3)을 그대로 다시 거르기만 한다.
 *
 * 서버 cap보다 관대한 값을 넣어도 서버가 이미 뺀 후보가 되살아나진 않는다 —
 * "표시 범위를 더 좁힐 수만 있다"는 게 이 필터의 한계다.
 */
export function filterByMaxDetourMinutes(
  candidates: WireCandidate[],
  maxDetourMinutes: number,
): WireCandidate[] {
  const maxDetourS = maxDetourMinutes * 60;
  return candidates.filter((c) => c.detour.durationS <= maxDetourS);
}
