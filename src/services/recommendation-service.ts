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
import {
  classifyByDetour,
  isOutOfRange,
  isOnRouteCandidate,
  routeAvgSpeedKmh,
  estimateDetourDurationSAtSpeed,
} from "@/domain/tier";
import {
  estimateDetourDistanceM,
  estimateDetourDurationS,
  netSaving,
  totalCost,
  computeScores,
  passesDetourGate,
  gateDetourDistanceM,
  withinDetourBudget,
  exceedsDetourCap,
  scoreByMode,
} from "@/domain/pricing";
import { buildReason } from "@/domain/reason";
import {
  T2_MAX,
  T3_MAX,
  MAX_PRECISE,
  MAX_RESULTS,
  MIN_ROUTE_DISTANCE,
  DEFAULT_MAX_DETOUR_MINUTES,
} from "@/domain/params";
import type {
  SearchInput,
  SearchResult,
  SearchStage,
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
  /** 배지 — 실측 `ΔT`·`ΔD`로 판정 (§6.4). 실측 전에는 추정치, `precise:false`. */
  tier: Tier;
  detourDistanceM: number;
  detourDurationS: number;
  /** 이 우회로 추가되는 통행료(원). 실측(STEP10) 전에는 알 수 없어 undefined. */
  tollWon?: number;
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
    if (isOutOfRange(dPerp)) continue; // A13 — T3_MAX 초과
    const detourDistanceM = estimateDetourDistanceM(dPerp);
    const detourDurationS = estimateDetourDurationS(detourDistanceM);
    result.push({
      station,
      price,
      pricedOn,
      dPerp,
      // 실측 전이라 추정치 기준. STEP 6·9에서 실측값으로 덮인다.
      tier: classifyByDetour(detourDurationS, detourDistanceM),
      detourDistanceM,
      detourDurationS,
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
      detour: {
        precise: w.ic.precise,
        distanceM: w.ic.detourDistanceM,
        durationS: w.ic.detourDurationS,
        tollWon: w.ic.tollWon,
      },
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

interface MeasureCtx {
  input: SearchInput;
  baseRoute: BaseRoute;
  redis: RedisLike;
  prefix: string;
}

/**
 * 경유지 경로를 병렬 실측해 ΔD·ΔT·통행료를 채웁니다 — STAGE 1(STEP 6)과 STEP 9b 공용.
 * 실패한 후보(A8)는 추정치를 그대로 유지하고 `precise: false`로 남습니다.
 */
async function measureBatch(
  targets: InternalCandidate[],
  ctx: MeasureCtx,
): Promise<InternalCandidate[]> {
  const results = await Promise.allSettled(
    targets.map((ic) =>
      getRoute({
        origin: ctx.input.origin,
        destination: ctx.input.destination,
        waypoint: ic.station.location,
        fuel: ctx.input.vehicle.fuel,
        avoidHighway: ctx.input.avoidHighway,
        retries: 0,
        redis: ctx.redis,
        prefix: ctx.prefix,
      }),
    ),
  );

  return targets.map((ic, idx) => {
    const result = results[idx];
    // A8 — 이 후보만 추정치 유지. 정렬 1차 키가 precise라 실측군 아래로 내려간다.
    if (result.status !== "fulfilled") return ic;
    const preciseRoute = result.value;
    const detourDistanceM = Math.max(0, preciseRoute.distanceM - ctx.baseRoute.distanceM);
    const detourDurationS = Math.max(0, preciseRoute.durationS - ctx.baseRoute.durationS);
    return {
      ...ic,
      detourDistanceM,
      detourDurationS,
      // 정보 표시 전용 (netSaving 미반영) — DetourInfo.tollWon 주석 참고.
      tollWon:
        preciseRoute.tollWon != null && ctx.baseRoute.tollWon != null
          ? Math.max(0, preciseRoute.tollWon - ctx.baseRoute.tollWon)
          : undefined,
      // 배지는 실측 ΔT·ΔD 두 값으로 판정한다 (§6.4).
      tier: classifyByDetour(detourDurationS, detourDistanceM),
      precise: true,
    };
  });
}

/**
 * STAGE 1 — 경로상 후보 목록 (§7.2 STEP 6, 불변식 6a).
 * 프리필터 통과분을 가격 싼 순 `MAX_PRECISE`개 실측(조기 종료 없음), 배지가 경로상인 것 전부 반환.
 */
async function findOnRouteCandidates(
  internal: InternalCandidate[],
  ctx: MeasureCtx,
): Promise<{ onRoute: InternalCandidate[]; measured: InternalCandidate[] }> {
  const targets = internal
    .filter((ic) => isOnRouteCandidate(ic.dPerp))
    .sort((a, b) => a.price - b.price || a.station.id.localeCompare(b.station.id))
    .slice(0, MAX_PRECISE);

  const measured = await measureBatch(targets, ctx);
  const onRoute = measured.filter((ic) => ic.precise && ic.tier === "ON_ROUTE");
  return { onRoute, measured };
}

/** 실측 결과를 후보 풀에 병합 — 같은 주유소는 실측값이 이긴다. */
function mergeMeasured(
  pool: InternalCandidate[],
  measured: InternalCandidate[],
): InternalCandidate[] {
  if (measured.length === 0) return pool;
  const byId = new Map(measured.map((ic) => [ic.station.id, ic]));
  return pool.map((ic) => byId.get(ic.station.id) ?? ic);
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
    avoidHighway: input.avoidHighway,
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

  // STEP4 — d_perp 산출 · T3_MAX 초과 제거(A13). **티어는 여기서 만들지 않는다** — §6.4
  let internal = toInternalCandidates(collected.stations, projectedPolyline);

  // STEP5 — P_ref. 표본은 d_perp ≤ T2_MAX — "이 지역 시세"는 기하 개념이 맞다 (§6.4)
  const refSample = internal.filter((ic) => ic.dPerp <= T2_MAX);
  const priceResult = await computeReferencePrice({
    t1t2Prices: refSample.map((ic) => ic.price),
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
  }

  const measureCtx: MeasureCtx = { input, baseRoute, redis, prefix };

  // ─── STAGE 1 — 경로상 목록 (§7.2 STEP 6, 불변식 6a) ─────────────────────────
  onProgress?.({ type: "progress", step: "PRECISE" });
  const { onRoute, measured: stage1Measured } = await findOnRouteCandidates(internal, measureCtx);
  internal = mergeMeasured(internal, stage1Measured);
  const onRouteIds = new Set(onRoute.map((ic) => ic.station.id));

  // 경로상이 있고 우회 미요청이면 여기서 끝 (§6.6).
  if (onRoute.length > 0 && !input.includeDetour) {
    const candidates = finalizeCandidates(
      onRoute,
      referencePrice,
      input.vehicle,
      input.mode,
      input.filters.facilities.length > 0,
    ).slice(0, MAX_RESULTS);

    const onRouteResult: SearchResult = {
      searchId: crypto.randomUUID(),
      baseRoute,
      candidates,
      referencePrice,
      refPriceSource,
      expansion: { triggered: false, finalRadiusM: T2_MAX }, // 우회 안 함 → 배너 OFF
      warnings,
      stage: "ON_ROUTE",
      minutesNeededForOneResult: null,
    };
    void logSearch(onRouteResult, { durationMs: Date.now() - startedAt });
    return onRouteResult;
  }

  // ─── STAGE 2 — 우회 탐색 (§7.2 STEP 7, 불변식 6a) ──────────────────────────
  // 확정 경로상은 판정에서 빼고 STEP 10에서 다시 합친다.
  const stage: SearchStage = "DETOUR";
  const maxDetourMinutes = input.maxDetourMinutes ?? DEFAULT_MAX_DETOUR_MINUTES;
  const routeSpeedKmh = routeAvgSpeedKmh(baseRoute.distanceM, baseRoute.durationS);

  let detourPool = internal.filter((ic) => !onRouteIds.has(ic.station.id));

  // 기준가 없으면 NetSaving 게이트 판정 불가 → 우회 후보를 남길 수 없다.
  if (referencePrice == null) {
    detourPool = detourPool.filter((ic) => ic.dPerp <= T2_MAX);
  }

  // STEP7 — 우회 게이트: 우회 허용 시간 예산 + NetSaving > 0
  const overBudget: InternalCandidate[] = [];
  detourPool = detourPool.filter((ic) => {
    const estimatedDetourDurationS = estimateDetourDurationSAtSpeed(
      gateDetourDistanceM(ic.dPerp),
      routeSpeedKmh,
    );
    if (!withinDetourBudget({ estimatedDetourDurationS, maxDetourMinutes })) {
      overBudget.push({ ...ic, detourDurationS: estimatedDetourDurationS });
      return false;
    }
    if (referencePrice == null) return true;
    return passesDetourGate({
      priceRefWon: referencePrice,
      priceStationWon: ic.price,
      refuelAmountL: input.vehicle.refuelAmountL,
      dPerpM: ic.dPerp,
      efficiencyKmPerL: input.vehicle.efficiencyKmPerL,
    });
  });

  // 추정 단계에서 예산에 걸려 빠진 후보 — STEP10에서 실측 탈락분과 합쳐 "N분으로 늘리기"에 쓴다.
  const budgetDropped: InternalCandidate[] = [...overBudget];

  const hasFacilityFilter = filters.facilities.length > 0;

  // "경로에서 몇 km까지 살폈나" — 최종 후보 중 최대 d_perp. 배지가 아니라 기하 개념 (§5.3 ②).
  function computeFinalRadiusM(list: InternalCandidate[]): number {
    const maxDPerp = list.length > 0 ? Math.max(...list.map((ic) => ic.dPerp)) : 0;
    return Math.max(T2_MAX, maxDPerp);
  }

  // STEP9a — 정밀 계산 대상 선정을 STEP8보다 먼저. MAX_PRECISE === MAX_RESULTS라
  // 여기서 뽑힌 집합이 곧 STAGE 2 목록이고 partial·result 구성원이 같아진다 (§7.2 STEP 9).
  const preciseTargets = selectPreciseTargets(detourPool, input.mode, input.vehicle);
  let internalStage2 = preciseTargets;

  // 정밀 계산 전에 EXPAND 안내 방출 — 최종 반경은 이미 정해졌다 (§6 제거 금지).
  const finalRadiusForProgress = computeFinalRadiusM([...onRoute, ...internalStage2]);
  if (finalRadiusForProgress > T2_MAX) {
    onProgress?.({ type: "progress", step: "EXPAND", radiusM: finalRadiusForProgress });
  }

  // STEP9 — 1차 스코어링(추정치) + partial 이벤트. STAGE 1 목록 + STAGE 2 후보를 합쳐 보낸다.
  const partialCandidates = finalizeCandidates(
    [...onRoute, ...internalStage2],
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
      expansion: {
        triggered: computeFinalRadiusM([...onRoute, ...internalStage2]) > T2_MAX,
        finalRadiusM: computeFinalRadiusM([...onRoute, ...internalStage2]),
      },
    },
  });

  // STEP9b — 정밀 계산. STAGE 1이 이미 잰 후보는 건너뛴다 (예산 이중 지출 방지).
  onProgress?.({ type: "progress", step: "PRECISE" });
  const unmeasured = preciseTargets.filter((ic) => !ic.precise);
  internalStage2 = mergeMeasured(preciseTargets, await measureBatch(unmeasured, measureCtx));

  // STEP10 — 최종 정리. A6·예산 재확인은 STAGE 2 후보에만 — 경로상은 이미 통과했다.
  internalStage2 = internalStage2.filter(
    (ic) =>
      !exceedsDetourCap({
        detourDistanceM: ic.detourDistanceM,
        detourDurationS: ic.detourDurationS,
        baseDistanceM: baseRoute.distanceM,
        baseDurationS: baseRoute.durationS,
      }),
  ); // A6

  // 우회 허용 시간 예산을 실측값으로 한 번 더 확인 — 추정 게이트(낙관적 계수)가 통과시킨
  // 후보가 실측에서 예산을 넘길 수 있다.
  internalStage2 = internalStage2.filter((ic) => {
    if (ic.precise && ic.detourDurationS > maxDetourMinutes * 60) {
      budgetDropped.push(ic);
      return false;
    }
    return true;
  });

  // 최종 목록 = STAGE 1 경로상 + STAGE 2 우회 (finalizeCandidates가 총비용순 정렬).
  const internal2 = [...onRoute, ...internalStage2];

  // "N분으로 늘리기" — 우회 0건 + 예산 탈락분이 있을 때만. 실측 탈락분 우선, 없으면 추정.
  const droppedByMeasurement = budgetDropped.filter((ic) => ic.precise);
  const basis = droppedByMeasurement.length > 0 ? droppedByMeasurement : budgetDropped;
  const minutesNeededForOneResult =
    internalStage2.length === 0 && basis.length > 0
      ? Math.ceil(Math.min(...basis.map((ic) => ic.detourDurationS)) / 60 / 5) * 5
      : null;

  const finalRadiusM = computeFinalRadiusM(internal2);
  let finalCandidates = finalizeCandidates(
    internal2,
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
    stage,
    minutesNeededForOneResult,
  };

  void logSearch(result, { durationMs: now.getTime() - startedAt }).catch(() => {});

  return result;
}
