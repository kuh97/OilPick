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

  // 실측군을 추정군보다 항상 위에 둔다 — AGENTS.md §5 불변식 4.
  //
  // 이 한 줄이 없으면 정밀 계산이 스스로를 파괴한다. 실측은 추정보다 우회를 크게
  // 잡는 쪽으로만 움직이므로(Phase 10 실측 — 추정 0.1분 → 실측 3~10분), 실측치와
  // 추정치를 같은 표에서 정렬하면 **실측된 후보가 반드시 진다.** 실제로 화면에
  // 보이던 15개가 전부 미검증 추정치였고, 정밀 계산한 6개는 17~112위로 밀려나 있었다.
  const sorted = [...withScores].sort((a, b) => {
    const byPrecise = Number(b.ic.precise) - Number(a.ic.precise);
    if (byPrecise !== 0) return byPrecise;
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
 * **이 함수가 곧 최종 목록의 구성원을 정합니다.** `MAX_PRECISE === MAX_RESULTS`이고
 * 화면에 올리는 후보는 전부 실측하므로(§7.3), 여기서 뽑히지 못한 후보는 화면에
 * 오르지 않습니다. 예전에는 모드별 top3 합집합(최대 9개)을 만든 뒤 6개로 잘랐지만,
 * 그러면 예산을 다 쓰지 못하고 남는 데다 실측 6 : 추정 144라는 비대칭이 순위를
 * 통째로 뒤집었습니다.
 *
 * 1. 세 모드 각각의 추정 순위 상위 `ceil(MAX_PRECISE / 3)`개를 뽑아 합집합을 만든다
 *    — 사용자가 탭을 전환해도 실측된 후보가 상위에 있게 하기 위함(재호출 0회).
 * 2. 예산이 남으면 현재 모드 점수 순으로 채운다.
 * 3. 현재 모드 → balanced → id 사전순으로 정렬해 `MAX_PRECISE`개로 자른다.
 *
 * 점수는 STEP 9(상위 finalizeCandidates)와 **완전히 같은 입력**으로 계산해야 합니다.
 * STEP 10이 말하는 "추정 순위"는 STEP 9가 만든 순위이고, 거기서 추정치인 것은
 * ΔD̂·ΔT̂뿐입니다 — 차량 파라미터가 아닙니다(§8 점수식).
 *
 * refuelAmountL을 0으로 두면 지배항인 주유비 Q×P_s(45L×1,700원 ≈ 76,500원)가
 * 점수에서 통째로 사라져, 남은 우회 연료비(≈ 1,700원)만으로 세 모드가 전부
 * "우회거리 순"으로 무너집니다.
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

  const perMode = Math.ceil(MAX_PRECISE / MODES.length);
  const selected = new Set<string>();
  for (const m of MODES) {
    const top = [...withScores]
      .sort((a, b) => scoreByMode(a.scores, m) - scoreByMode(b.scores, m))
      .slice(0, perMode);
    for (const w of top) selected.add(w.ic.station.id);
  }

  // 모드 간 겹침으로 예산이 남으면 현재 모드 순으로 채운다.
  if (selected.size < MAX_PRECISE) {
    const byCurrent = [...withScores].sort(
      (a, b) => scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode),
    );
    for (const w of byCurrent) {
      if (selected.size >= MAX_PRECISE) break;
      selected.add(w.ic.station.id);
    }
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

  // STEP10a — 정밀 계산 대상 선정을 STEP9보다 먼저 한다.
  //
  // 화면에 올리는 후보는 전부 실측하므로(MAX_PRECISE === MAX_RESULTS) 여기서 뽑힌
  // 집합이 곧 최종 목록이다. 이후 파이프라인은 이 집합만 다룬다 — partial과 result의
  // **구성원이 같아지고 순위·수치만 갱신**되므로, 로딩 중 보던 카드가 통째로 다른
  // 목록으로 바뀌는 일이 없어진다 (PRODUCT.md §7.2 STEP 11).
  const preciseTargets = selectPreciseTargets(internal, input.mode, input.vehicle);
  internal = preciseTargets;

  // 회랑 수집이 T1~T3를 한 번에 가져와 STEP5·6(확장 게이트·수집)이 없어졌지만,
  // "충분히 못 찾아 넓혀 찾았다"는 로딩 중 안내(AGENTS.md §6 제거 금지)는 결과가
  // 나오기 전에도 떠야 한다. 대상 선정이 끝난 시점에 최종 반경이 이미 정해졌으므로,
  // 정밀 계산(STEP10b, 실제 카카오 API 호출이 있어 시간이 걸림)이 시작되기 전에
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

  // STEP10b — 정밀 계산
  onProgress?.({ type: "progress", step: "PRECISE" });

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

  // internal === preciseTargets 이므로 인덱스가 preciseResults와 그대로 대응한다.
  internal = internal.map((ic, idx) => {
    const result = preciseResults[idx];
    // A8 — 이 후보만 추정치 유지. 정렬 1차 키가 precise라 실측군 아래로 내려간다.
    if (result.status !== "fulfilled") return ic;
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
  internal = internal.filter(
    (ic) =>
      !exceedsDetourCap({
        detourDistanceM: ic.detourDistanceM,
        detourDurationS: ic.detourDurationS,
        baseDistanceM: baseRoute.distanceM,
        baseDurationS: baseRoute.durationS,
      }),
  ); // A6

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
