/**
 * 오케스트레이터 — STEP 1~11 전체.
 * ARCHITECTURE.md §9.1(파이프라인 다이어그램), §3.3(SSE와 폴백 — 한 서비스, 두 출구).
 *
 * `onProgress`는 옵셔널 콜백일 뿐입니다 — SSE 프레이밍은 Phase 8의 몫입니다.
 * 콜백 유무가 로직을 분기하지 않으므로, 둘 다 같은 SearchResult를 반환합니다.
 */

import { getRoute } from "./route-service";
import { collectStations } from "./station-service";
import { computeReferencePrice } from "./price-service";
import { logSearch } from "./event-service";
import { getRedis } from "@/infra/cache/redis";
import { getDb } from "@/infra/db/client";
import { env } from "@/infra/env";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { classifyTier, classifyTierByDetour } from "@/domain/tier";
import {
  estimateDetourDistanceM,
  estimateDetourDurationS,
  netSaving,
  totalCost,
  computeScores,
  passesT3Gate,
  exceedsDetourCap,
  scoreByMode,
} from "@/domain/pricing";
import { buildReason } from "@/domain/reason";
import { T2_MAX, T3_MAX, MAX_PRECISE, MAX_RESULTS, MIN_ROUTE_DISTANCE } from "@/domain/params";
import type {
  SearchInput,
  SearchResult,
  Candidate,
  BaseRoute,
  RefuelPoint,
  Tier,
  Mode,
  Vehicle,
  Warning,
  RefPriceSource,
} from "@/domain/types";
import type { RedisLike } from "./route-service";
import type { Db } from "@/infra/db/client";

export type ProgressStep = "ROUTE" | "COLLECT" | "EXPAND" | "PRECISE";

export type ProgressEvent =
  | { type: "progress"; step: ProgressStep; radiusM?: number }
  | { type: "base_route"; data: BaseRoute }
  | {
      type: "partial";
      data: {
        candidates: Candidate[];
        referencePrice: number | null;
        refPriceSource: RefPriceSource | null;
        expansion: SearchResult["expansion"];
      };
    }
  | { type: "warning"; data: Warning };

export type OnProgress = (event: ProgressEvent) => void;

export interface SearchDeps {
  redis?: RedisLike;
  db?: Db;
  prefix?: string;
  now?: Date;
}

interface InternalCandidate {
  station: RefuelPoint;
  price: number;
  /** CSV 기준일자("YYYY-MM-DD"). 상세 API로만 채워진 행은 null — priceUpdatedAt이 비게 됨 */
  pricedOn: string | null;
  dPerp: number;
  /** d_perp 기준 기하 티어 — P_ref·T3 게이트·확장 배너 등 파이프라인 판정의 근거. 불변. */
  geoTier: Tier;
  /** 화면에 표시하는 티어. precise 후보는 실측 우회거리로 재판정되어 geoTier와 다를 수 있음. */
  tier: Tier;
  detourDistanceM: number;
  detourDurationS: number;
  precise: boolean;
}

const MODES: readonly Mode[] = ["balanced", "minCost", "minDistance"];

/** "YYYY-MM-DD" → 해당 날짜 UTC 자정 Date. §9.1·§9.2 — 실제 가격 기준일자를 그대로 표시합니다. */
function pricedOnToDate(pricedOn: string | null): Date | undefined {
  return pricedOn ? new Date(`${pricedOn}T00:00:00Z`) : undefined;
}

function toInternalCandidates(
  stations: Array<{ station: RefuelPoint; price: number; pricedOn: string | null }>,
  projectedPolyline: ReturnType<typeof wgs84ToProjected>[],
): InternalCandidate[] {
  const result: InternalCandidate[] = [];
  for (const { station, price, pricedOn } of stations) {
    const stationProjected = wgs84ToProjected(station.location);
    const dPerp = pointToPolylineDistanceM(stationProjected, projectedPolyline);
    const tier = classifyTier(dPerp);
    if (!tier) continue; // A13 — T3_MAX 초과
    const detourDistanceM = estimateDetourDistanceM(dPerp);
    result.push({
      station,
      price,
      pricedOn,
      dPerp,
      geoTier: tier,
      tier,
      detourDistanceM,
      detourDurationS: estimateDetourDurationS(detourDistanceM),
      precise: false,
    });
  }
  return result;
}

function finalizeCandidates(
  internal: InternalCandidate[],
  priceRefWon: number | null,
  vehicle: Vehicle,
  mode: Mode,
  hasFacilityFilter: boolean,
): Candidate[] {
  const withScores = internal.map((ic) => {
    const tc = totalCost({
      priceStationWon: ic.price,
      refuelAmountL: vehicle.refuelAmountL,
      detourDistanceM: ic.detourDistanceM,
      efficiencyKmPerL: vehicle.efficiencyKmPerL,
    });
    const scores = computeScores({
      priceStationWon: ic.price,
      refuelAmountL: vehicle.refuelAmountL,
      detourDistanceM: ic.detourDistanceM,
      detourDurationS: ic.detourDurationS,
      efficiencyKmPerL: vehicle.efficiencyKmPerL,
      timeValuePerMin: vehicle.timeValuePerMin,
    });
    const netSavingWon =
      priceRefWon != null
        ? netSaving({
            priceRefWon,
            priceStationWon: ic.price,
            refuelAmountL: vehicle.refuelAmountL,
            detourDistanceM: ic.detourDistanceM,
            efficiencyKmPerL: vehicle.efficiencyKmPerL,
          })
        : 0;
    return { ic, totalCostWon: tc, scores, netSavingWon };
  });

  const byPrice = [...withScores].sort((a, b) => a.ic.price - b.ic.price);
  const priceRank = new Map<string, number>();
  byPrice.forEach((w, i) => priceRank.set(w.ic.station.id, i + 1));

  const sorted = [...withScores].sort((a, b) => {
    if (priceRefWon == null) return a.ic.price - b.ic.price;
    return scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
  });

  return sorted.map((w, i) => {
    const rank = i + 1;
    const reason = buildReason({
      rank,
      tier: w.ic.tier,
      priceRefWon: priceRefWon ?? w.ic.price,
      priceStationWon: w.ic.price,
      priceRankAmongAll: priceRank.get(w.ic.station.id)!,
      totalCandidates: withScores.length,
      detourDistanceM: w.ic.detourDistanceM,
      detourDurationS: w.ic.detourDurationS,
      hasFacilityMatch: hasFacilityFilter,
      mode,
    });
    return {
      station: w.ic.station,
      price: w.ic.price,
      dPerp: w.ic.dPerp,
      tier: w.ic.tier,
      detour: { precise: w.ic.precise, distanceM: w.ic.detourDistanceM, durationS: w.ic.detourDurationS },
      netSaving: w.netSavingWon,
      totalCost: w.totalCostWon,
      scores: w.scores,
      reason,
      priceUpdatedAt: pricedOnToDate(w.ic.pricedOn),
    };
  });
}

/**
 * STEP 10 정밀 계산 대상 선정 — PRODUCT.md §7.2 STEP 10.
 *
 * 점수는 STEP 9(상위 finalizeCandidates)와 **완전히 같은 입력**으로 계산해야 합니다.
 * STEP 10이 말하는 "추정 순위"는 STEP 9가 만든 순위이고, 거기서 추정치인 것은
 * ΔD̂·ΔT̂뿐입니다 — 차량 파라미터가 아닙니다(§8 점수식).
 *
 * refuelAmountL을 0으로 두면 지배항인 주유비 Q×P_s(45L×1,700원 ≈ 76,500원)가
 * 점수에서 통째로 사라져, 남은 우회 연료비(≈ 1,700원)만으로 세 모드가 전부
 * "우회거리 순"으로 무너집니다. 그러면 모드별 top3 합집합이 항상 같은 3개가 되고,
 * minCost에서는 선정 순위와 최종 표시 순위가 정반대로 뒤집어 사용자가 1위로 보는
 * 후보가 오히려 추정치(§6.4 — 실제와 최대 12배 어긋날 수 있음)로 남습니다.
 */
function selectPreciseTargets(
  internal: InternalCandidate[],
  mode: Mode,
  vehicle: Vehicle,
): InternalCandidate[] {
  const withScores = internal.map((ic) => ({
    ic,
    scores: computeScores({
      priceStationWon: ic.price,
      refuelAmountL: vehicle.refuelAmountL,
      detourDistanceM: ic.detourDistanceM,
      detourDurationS: ic.detourDurationS,
      efficiencyKmPerL: vehicle.efficiencyKmPerL,
      timeValuePerMin: vehicle.timeValuePerMin,
    }),
  }));

  const selected = new Set<string>();
  for (const m of MODES) {
    const top3 = [...withScores]
      .sort((a, b) => scoreByMode(a.scores, m) - scoreByMode(b.scores, m))
      .slice(0, 3);
    for (const w of top3) selected.add(w.ic.station.id);
  }

  const currentModeScore = new Map(withScores.map((w) => [w.ic.station.id, w.scores]));
  const chosen = internal.filter((ic) => selected.has(ic.station.id));
  chosen.sort((a, b) => {
    const sa = currentModeScore.get(a.station.id)!;
    const sb = currentModeScore.get(b.station.id)!;
    const byMode = scoreByMode(sa, mode) - scoreByMode(sb, mode);
    if (byMode !== 0) return byMode;
    const byBalanced = sa.balanced - sb.balanced;
    if (byBalanced !== 0) return byBalanced;
    return a.station.id.localeCompare(b.station.id);
  });
  return chosen.slice(0, MAX_PRECISE);
}

/** 오케스트레이터 본체. */
export async function search(
  input: SearchInput,
  onProgress?: OnProgress,
  deps: SearchDeps = {},
): Promise<SearchResult> {
  const redis: RedisLike = deps.redis ?? getRedis();
  const db = deps.db ?? getDb();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const now = deps.now ?? new Date();
  const startedAt = now.getTime();

  const warnings: Warning[] = [];

  // STEP1 — 기본 경로
  onProgress?.({ type: "progress", step: "ROUTE" });
  const baseRoute = await getRoute({
    origin: input.origin,
    destination: input.destination,
    fuel: input.vehicle.fuel,
    redis,
    prefix,
  });
  onProgress?.({ type: "base_route", data: baseRoute });

  if (baseRoute.distanceM < MIN_ROUTE_DISTANCE) {
    const warning: Warning = { code: "SHORT_ROUTE", message: "경로가 짧아 절감 효과가 크지 않을 수 있습니다." };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
  }

  // STEP2 — 경로 폴리라인을 투영좌표로
  onProgress?.({ type: "progress", step: "COLLECT" });
  const projectedPolyline = baseRoute.polyline.map(wgs84ToProjected);

  const filters = {
    facilities: input.filters.facilities,
    brands: input.filters.brands,
    kpetroOnly: input.filters.kpetroOnly,
    selfOnly: input.filters.selfOnly,
  };

  // STEP3 — 회랑(경로 bbox) 수집. T1~T3를 한 번에 가져오므로 확장 수집이 필요 없다
  // (docs/MIGRATION-DB.md §7 Phase C).
  const collected = await collectStations({
    referencePoints: projectedPolyline,
    marginM: T3_MAX,
    fuel: input.vehicle.fuel,
    filters,
    now,
    db,
  });

  // STEP4 — d_perp · tier 분류 (T3_MAX 초과는 A13으로 제외됨)
  let internal = toInternalCandidates(collected.stations, projectedPolyline);

  // STEP7 — P_ref
  const t1t2 = internal.filter((ic) => ic.geoTier === "T1" || ic.geoTier === "T2");
  const priceResult = await computeReferencePrice({
    t1t2Prices: t1t2.map((ic) => ic.price),
    pool: internal.map((ic) => ({ sigunCd: ic.station.sigunCd })),
    fuel: input.vehicle.fuel,
    db,
  });

  let referencePrice: number | null = null;
  let refPriceSource: RefPriceSource | null = null;
  if (priceResult) {
    referencePrice = priceResult.price;
    refPriceSource = priceResult.source;
  } else {
    const warning: Warning = {
      code: "NO_REFERENCE_PRICE",
      message: "기준가를 계산할 수 없어 절감액 대신 가격순으로 정렬합니다.",
    };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
    // T3는 순절감액 게이트를 판정할 수 없으므로 제외합니다.
    internal = internal.filter((ic) => ic.geoTier !== "T3");
  }

  // STEP8 — T3 게이트 (referencePrice가 있을 때만 의미가 있음)
  if (referencePrice != null) {
    internal = internal.filter((ic) => {
      if (ic.geoTier !== "T3") return true;
      return passesT3Gate({
        priceRefWon: referencePrice!,
        priceStationWon: ic.price,
        refuelAmountL: input.vehicle.refuelAmountL,
        dPerpM: ic.dPerp,
        efficiencyKmPerL: input.vehicle.efficiencyKmPerL,
      });
    });
  }

  const hasFacilityFilter = filters.facilities.length > 0;

  // "어디까지 뒤졌나"는 기하 개념 — 배지가 재판정된 tier가 아니라 geoTier로 본다.
  function computeFinalRadiusM(list: InternalCandidate[]): number {
    const t3 = list.filter((ic) => ic.geoTier === "T3");
    if (t3.length === 0) return T2_MAX;
    return Math.max(...t3.map((ic) => ic.dPerp));
  }

  // 회랑 수집이 T1~T3를 한 번에 가져와 STEP5·6(확장 게이트·수집)이 없어졌지만,
  // "충분히 못 찾아 넓혀 찾았다"는 로딩 중 안내(AGENTS.md §6 제거 금지)는 결과가
  // 나오기 전에도 떠야 한다. T3 게이트 직후 최종 반경이 이미 정해졌으므로,
  // 정밀 계산(STEP10, 실제 카카오 API 호출이 있어 시간이 걸림)이 시작되기 전에
  // 이 시점에서 알린다 — 가짜 지연이 아니라 이미 일어난 일을 알리는 것뿐이다.
  const finalRadiusForProgress = computeFinalRadiusM(internal);
  if (finalRadiusForProgress > T2_MAX) {
    onProgress?.({ type: "progress", step: "EXPAND", radiusM: finalRadiusForProgress });
  }

  // STEP9 — 1차 스코어링(추정치) + partial 이벤트
  const partialCandidates = finalizeCandidates(
    internal,
    referencePrice,
    input.vehicle,
    input.mode,
    hasFacilityFilter,
  );
  onProgress?.({
    type: "partial",
    data: {
      candidates: partialCandidates,
      referencePrice,
      refPriceSource,
      // 회랑 수집이 T1~T3를 한 번에 가져오므로 "확장"이라는 별도 단계는 없다.
      // 배너(AGENTS.md §6 제거 금지)는 "최종 채택된 후보가 T2_MAX를 넘겨 우회했는가"로
      // 계속 켜진다 — finalRadiusM만 보고 그려지므로 문구는 그대로 유지된다.
      expansion: {
        triggered: computeFinalRadiusM(internal) > T2_MAX,
        finalRadiusM: computeFinalRadiusM(internal),
      },
    },
  });

  // STEP10 — 정밀 계산
  onProgress?.({ type: "progress", step: "PRECISE" });
  const preciseTargets = selectPreciseTargets(internal, input.mode, input.vehicle);
  const preciseIds = new Set(preciseTargets.map((ic) => ic.station.id));

  const preciseResults = await Promise.allSettled(
    preciseTargets.map((ic) =>
      getRoute({
        origin: input.origin,
        destination: input.destination,
        waypoint: ic.station.location,
        fuel: input.vehicle.fuel,
        retries: 0,
        redis,
        prefix,
      }),
    ),
  );

  internal = internal.map((ic) => {
    if (!preciseIds.has(ic.station.id)) return ic;
    const idx = preciseTargets.findIndex((t) => t.station.id === ic.station.id);
    const result = preciseResults[idx];
    if (result.status !== "fulfilled") return ic; // A8 — 추정치 유지
    const preciseRoute = result.value;
    const detourDistanceM = Math.max(0, preciseRoute.distanceM - baseRoute.distanceM);
    return {
      ...ic,
      detourDistanceM,
      detourDurationS: Math.max(0, preciseRoute.durationS - baseRoute.durationS),
      // 실측 우회거리로 배지 재판정 (geoTier는 유지 — §6.4)
      tier: classifyTierByDetour(detourDistanceM),
      precise: true,
    };
  });

  // STEP11 — 최종 정리
  internal = internal.filter((ic) => !exceedsDetourCap(ic.detourDistanceM, baseRoute.distanceM)); // A6

  const finalRadiusM = computeFinalRadiusM(internal);
  let finalCandidates = finalizeCandidates(
    internal,
    referencePrice,
    input.vehicle,
    input.mode,
    hasFacilityFilter,
  );
  finalCandidates = finalCandidates.slice(0, MAX_RESULTS);

  const result: SearchResult = {
    searchId: crypto.randomUUID(),
    baseRoute,
    candidates: finalCandidates,
    referencePrice,
    refPriceSource,
    expansion: { triggered: finalRadiusM > T2_MAX, finalRadiusM },
    warnings,
  };

  void logSearch(result, { durationMs: now.getTime() - startedAt }).catch(() => {});

  return result;
}
