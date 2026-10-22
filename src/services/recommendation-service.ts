/**
 * 오케스트레이터 — 카카오의 내비추천·최소시간·거리우선 경로를 비교한다.
 * 같은 도형의 기본 경로는 한 번만 탐색하고, 주유소가 겹치면 실제 경유 경로가 더
 * 좋은 버전 하나만 남긴다. 진행 콜백 유무와 무관하게 같은 결과를 만든다.
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
  Candidate,
  BaseRoute,
  RefuelPoint,
  Tier,
  Mode,
  Vehicle,
  Warning,
  RefPriceSource,
  RoutePriority,
  RouteVariant,
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
        baseRoutes: RouteVariant[];
      };
    }
  | { type: "warning"; data: Warning };
export type OnProgress = (event: ProgressEvent) => void;

export interface SearchDeps {
  redis?: RedisLike;
  db?: Db;
  prefix?: string;
  now?: Date;
  jsonFallback?: boolean;
}

interface InternalCandidate {
  station: RefuelPoint;
  price: number;
  pricedOn: string | null;
  route: RouteVariant;
  dPerp: number;
  tier: Tier;
  detourDistanceM: number;
  detourDurationS: number;
  tollWon?: number;
  /** 클램프 전 실제 경유 경로. 중복 주유소의 경로 버전 선택에만 쓴다. */
  viaDistanceM?: number;
  viaDurationS?: number;
  precise: boolean;
}

const MODES: readonly Mode[] = ["balanced", "minCost", "minDistance"];
const BASE_PRIORITIES: readonly RoutePriority[] = [
  "RECOMMEND",
  "TIME",
  "DISTANCE",
];

function priorityRank(priority: RoutePriority): number {
  return BASE_PRIORITIES.indexOf(priority);
}

function candidateKey(ic: InternalCandidate): string {
  return `${ic.station.id}:${ic.route.priority}`;
}

function pricedOnToDate(pricedOn: string | null): Date | undefined {
  return pricedOn ? new Date(`${pricedOn}T00:00:00Z`) : undefined;
}

/** Kakao가 같은 경로를 priority만 달리해 돌려줘도 회랑·정밀 계산을 반복하지 않는다. */
function routeFingerprint(route: BaseRoute): string {
  return route.polyline
    .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
    .join(";");
}

function dedupeBaseRoutes(routes: RouteVariant[]): RouteVariant[] {
  const seen = new Set<string>();
  return routes.filter((variant) => {
    const key = routeFingerprint(variant.route);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toInternalCandidates(
  stations: Array<{
    station: RefuelPoint;
    price: number;
    pricedOn: string | null;
  }>,
  route: RouteVariant,
): InternalCandidate[] {
  const projectedPolyline = route.route.polyline.map(wgs84ToProjected);
  const result: InternalCandidate[] = [];
  for (const { station, price, pricedOn } of stations) {
    const dPerp = pointToPolylineDistanceM(
      wgs84ToProjected(station.location),
      projectedPolyline,
    );
    if (isOutOfRange(dPerp)) continue;
    const detourDistanceM = estimateDetourDistanceM(dPerp);
    const detourDurationS = estimateDetourDurationS(detourDistanceM);
    result.push({
      station,
      price,
      pricedOn,
      route,
      dPerp,
      tier: classifyByDetour(detourDurationS, detourDistanceM),
      detourDistanceM,
      detourDurationS,
      precise: false,
    });
  }
  return result;
}

/** 기준가 표본은 한 주유소가 여러 회랑에 놓여도 한 번만 넣는다. */
function dedupeForReference(pool: InternalCandidate[]): InternalCandidate[] {
  const byStation = new Map<string, InternalCandidate>();
  for (const item of pool) {
    const previous = byStation.get(item.station.id);
    if (
      !previous ||
      item.dPerp < previous.dPerp ||
      (item.dPerp === previous.dPerp &&
        priorityRank(item.route.priority) <
          priorityRank(previous.route.priority))
    ) {
      byStation.set(item.station.id, item);
    }
  }
  return [...byStation.values()];
}

/** 동일 주유소는 최종 도착 시간·거리, 우회량, 우선순위 순으로 하나만 남긴다. */
function isBetterVariant(
  next: InternalCandidate,
  current: InternalCandidate,
): boolean {
  const comparisons: Array<[number, number]> = [
    [
      next.viaDurationS ?? Number.POSITIVE_INFINITY,
      current.viaDurationS ?? Number.POSITIVE_INFINITY,
    ],
    [
      next.viaDistanceM ?? Number.POSITIVE_INFINITY,
      current.viaDistanceM ?? Number.POSITIVE_INFINITY,
    ],
    [next.detourDurationS, current.detourDurationS],
    [next.detourDistanceM, current.detourDistanceM],
    [priorityRank(next.route.priority), priorityRank(current.route.priority)],
  ];
  for (const [a, b] of comparisons) {
    if (a !== b) return a < b;
  }
  return false;
}

function dedupeByStation(pool: InternalCandidate[]): InternalCandidate[] {
  const byStation = new Map<string, InternalCandidate>();
  for (const item of pool) {
    const previous = byStation.get(item.station.id);
    if (!previous || isBetterVariant(item, previous))
      byStation.set(item.station.id, item);
  }
  return [...byStation.values()];
}

function finalizeCandidates(
  internal: InternalCandidate[],
  priceRefWon: number | null,
  vehicle: Vehicle,
  mode: Mode,
  hasFacilityFilter: boolean,
): Candidate[] {
  const withScores = internal.map((ic) => {
    const totalCostWon = totalCost({
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
      priceRefWon == null
        ? 0
        : netSaving({
            priceRefWon,
            priceStationWon: ic.price,
            refuelAmountL: vehicle.refuelAmountL,
            detourDistanceM: ic.detourDistanceM,
            efficiencyKmPerL: vehicle.efficiencyKmPerL,
          });
    return { ic, totalCostWon, scores, netSavingWon };
  });
  const priceRank = new Map(
    [...withScores]
      .sort((a, b) => a.ic.price - b.ic.price)
      .map((item, index) => [item.ic.station.id, index + 1]),
  );
  const sorted = [...withScores].sort((a, b) => {
    const aOnRoute = a.ic.precise && a.ic.tier === "ON_ROUTE";
    const bOnRoute = b.ic.precise && b.ic.tier === "ON_ROUTE";
    if (aOnRoute !== bOnRoute) return Number(bOnRoute) - Number(aOnRoute);
    const byPrecise = Number(b.ic.precise) - Number(a.ic.precise);
    if (byPrecise !== 0) return byPrecise;
    return priceRefWon == null
      ? a.ic.price - b.ic.price
      : scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
  });
  return sorted.map((item, index) => ({
    station: item.ic.station,
    price: item.ic.price,
    dPerp: item.ic.dPerp,
    tier: item.ic.tier,
    detour: {
      precise: item.ic.precise,
      distanceM: item.ic.detourDistanceM,
      durationS: item.ic.detourDurationS,
      tollWon: item.ic.tollWon,
    },
    netSaving: item.netSavingWon,
    totalCost: item.totalCostWon,
    scores: item.scores,
    reason: buildReason({
      rank: index + 1,
      tier: item.ic.tier,
      priceRefWon: priceRefWon ?? item.ic.price,
      priceStationWon: item.ic.price,
      priceRankAmongAll: priceRank.get(item.ic.station.id)!,
      totalCandidates: withScores.length,
      detourDistanceM: item.ic.detourDistanceM,
      detourDurationS: item.ic.detourDurationS,
      hasFacilityMatch: hasFacilityFilter,
      mode,
    }),
    priceUpdatedAt: pricedOnToDate(item.ic.pricedOn),
    routePriority: item.ic.route.priority,
  }));
}

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
  for (const selectedMode of MODES) {
    for (const item of [...withScores]
      .sort(
        (a, b) =>
          scoreByMode(a.scores, selectedMode) -
          scoreByMode(b.scores, selectedMode),
      )
      .slice(0, perMode))
      selected.add(item.ic.station.id);
  }
  if (selected.size < MAX_PRECISE) {
    for (const item of [...withScores].sort(
      (a, b) => scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode),
    )) {
      if (selected.size >= MAX_PRECISE) break;
      selected.add(item.ic.station.id);
    }
  }
  const scores = new Map(
    withScores.map((item) => [item.ic.station.id, item.scores]),
  );
  return internal
    .filter((item) => selected.has(item.station.id))
    .sort((a, b) => {
      const byMode =
        scoreByMode(scores.get(a.station.id)!, mode) -
        scoreByMode(scores.get(b.station.id)!, mode);
      return (
        byMode ||
        scores.get(a.station.id)!.balanced -
          scores.get(b.station.id)!.balanced ||
        a.station.id.localeCompare(b.station.id)
      );
    })
    .slice(0, MAX_PRECISE);
}

interface MeasureCtx {
  input: SearchInput;
  redis: RedisLike;
  prefix: string;
}

async function measureBatch(
  targets: InternalCandidate[],
  ctx: MeasureCtx,
): Promise<{ candidates: InternalCandidate[]; routeCalls: number }> {
  const results = await Promise.allSettled(
    targets.map((item) =>
      getRoute({
        origin: ctx.input.origin,
        destination: ctx.input.destination,
        waypoint: item.station.location,
        fuel: ctx.input.vehicle.fuel,
        avoidHighway: ctx.input.avoidHighway,
        retries: 0,
        priority: item.route.priority,
        redis: ctx.redis,
        prefix: ctx.prefix,
      }),
    ),
  );
  return {
    routeCalls: targets.length,
    candidates: targets.map((item, index) => {
      const result = results[index];
      if (result.status !== "fulfilled") return item;
      const viaRoute = result.value;
      const detourDistanceM = Math.max(
        0,
        viaRoute.distanceM - item.route.route.distanceM,
      );
      const detourDurationS = Math.max(
        0,
        viaRoute.durationS - item.route.route.durationS,
      );
      return {
        ...item,
        detourDistanceM,
        detourDurationS,
        viaDistanceM: viaRoute.distanceM,
        viaDurationS: viaRoute.durationS,
        tollWon:
          viaRoute.tollWon != null && item.route.route.tollWon != null
            ? Math.max(0, viaRoute.tollWon - item.route.route.tollWon)
            : undefined,
        tier: classifyByDetour(detourDurationS, detourDistanceM),
        precise: true,
      };
    }),
  };
}

async function findOnRouteCandidates(
  internal: InternalCandidate[],
  ctx: MeasureCtx,
) {
  const targets = [...internal].sort(
    (a, b) => a.dPerp - b.dPerp || a.station.id.localeCompare(b.station.id),
  );
  const measured = await measureBatch(targets, ctx);
  return {
    onRoute: dedupeByStation(
      measured.candidates.filter(
        (item) => item.precise && item.tier === "ON_ROUTE",
      ),
    ),
    ...measured,
  };
}

function mergeMeasured(
  pool: InternalCandidate[],
  measured: InternalCandidate[],
): InternalCandidate[] {
  const byKey = new Map(measured.map((item) => [candidateKey(item), item]));
  return pool.map((item) => byKey.get(candidateKey(item)) ?? item);
}

function finalRadiusM(items: InternalCandidate[]): number {
  return Math.max(
    T2_MAX,
    items.length ? Math.max(...items.map((item) => item.dPerp)) : 0,
  );
}

/** 오케스트레이터 본체. */
export async function search(
  input: SearchInput,
  onProgress?: OnProgress,
  deps: SearchDeps = {},
): Promise<SearchResult> {
  const redis = deps.redis ?? getRedis();
  const db = deps.db ?? getDb();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const now = deps.now ?? new Date();
  const startedAt = now.getTime();
  const warnings: Warning[] = [];
  let routeCalls = BASE_PRIORITIES.length;

  onProgress?.({ type: "progress", step: "ROUTE" });
  const routes = await Promise.all(
    BASE_PRIORITIES.map(async (priority) => ({
      priority,
      route: await getRoute({
        origin: input.origin,
        destination: input.destination,
        fuel: input.vehicle.fuel,
        avoidHighway: input.avoidHighway,
        priority,
        redis,
        prefix,
      }),
    })),
  );
  const baseRoutes = dedupeBaseRoutes(routes);
  const baseRoute = baseRoutes[0].route;
  onProgress?.({ type: "base_route", data: baseRoute });
  if (baseRoute.distanceM < MIN_ROUTE_DISTANCE) {
    const warning: Warning = {
      code: "SHORT_ROUTE",
      message: "경로가 짧아 절감 효과가 크지 않을 수 있습니다.",
    };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
  }

  const filters = {
    facilities: input.filters.facilities,
    brands: input.filters.brands,
    kpetroOnly: input.filters.kpetroOnly,
    selfOnly: input.filters.selfOnly,
  };
  onProgress?.({ type: "progress", step: "COLLECT" });
  const collected = await Promise.all(
    baseRoutes.map(async (route) => ({
      route,
      collected: await collectStations({
        referencePoints: route.route.polyline.map(wgs84ToProjected),
        marginM: T3_MAX,
        fuel: input.vehicle.fuel,
        filters,
        now,
        db,
      }),
    })),
  );
  let internal = collected.flatMap(({ route, collected: found }) =>
    toInternalCandidates(found.stations, route),
  );
  const referencePool = dedupeForReference(internal);
  const priceResult = await computeReferencePrice({
    t1t2Prices: referencePool
      .filter((item) => item.dPerp <= T2_MAX)
      .map((item) => item.price),
    pool: referencePool.map((item) => ({ sigunCd: item.station.sigunCd })),
    fuel: input.vehicle.fuel,
    db,
  });
  const referencePrice = priceResult?.price ?? null;
  const refPriceSource = priceResult?.source ?? null;
  if (!priceResult) {
    const warning: Warning = {
      code: "NO_REFERENCE_PRICE",
      message: "기준가를 계산할 수 없어 절감액 대신 가격순으로 정렬합니다.",
    };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
  }

  const measureCtx: MeasureCtx = { input, redis, prefix };
  onProgress?.({ type: "progress", step: "PRECISE" });
  const stage1 = await findOnRouteCandidates(internal, measureCtx);
  routeCalls += stage1.routeCalls;
  internal = mergeMeasured(internal, stage1.candidates);

  // 어느 기본 경로에서든 경로상 후보가 있으면 우회 탐색은 하지 않는다.
  if (stage1.onRoute.length > 0) {
    const result: SearchResult = {
      searchId: crypto.randomUUID(),
      baseRoute,
      baseRoutes,
      candidates: finalizeCandidates(
        stage1.onRoute,
        referencePrice,
        input.vehicle,
        input.mode,
        filters.facilities.length > 0,
      ),
      referencePrice,
      refPriceSource,
      expansion: { triggered: false, finalRadiusM: T2_MAX },
      warnings,
      stage: "ON_ROUTE",
      minutesNeededForOneResult: null,
    };
    void logSearch(result, {
      durationMs: Date.now() - startedAt,
      fuel: input.vehicle.fuel,
      filters: input.filters,
      origin: input.origin,
      destination: input.destination,
      routeCalls,
      jsonFallback: deps.jsonFallback,
    }).catch(() => {});
    return result;
  }

  const maxDetourMinutes = input.maxDetourMinutes ?? DEFAULT_MAX_DETOUR_MINUTES;
  let detourPool = internal;
  if (referencePrice == null)
    detourPool = detourPool.filter((item) => item.dPerp <= T2_MAX);
  const budgetDropped: InternalCandidate[] = [];
  detourPool = detourPool.filter((item) => {
    const estimatedDetourDurationS = estimateDetourDurationSAtSpeed(
      gateDetourDistanceM(item.dPerp),
      routeAvgSpeedKmh(item.route.route.distanceM, item.route.route.durationS),
    );
    if (!withinDetourBudget({ estimatedDetourDurationS, maxDetourMinutes })) {
      budgetDropped.push({
        ...item,
        detourDurationS: estimatedDetourDurationS,
      });
      return false;
    }
    return (
      referencePrice == null ||
      passesDetourGate({
        priceRefWon: referencePrice,
        priceStationWon: item.price,
        refuelAmountL: input.vehicle.refuelAmountL,
        dPerpM: item.dPerp,
        efficiencyKmPerL: input.vehicle.efficiencyKmPerL,
      })
    );
  });
  // 상위 후보를 고를 때만 동일 주유소를 하나로 보고, 선택된 주유소는 모든 경로
  // 버전을 실측한다. 그래야 최종 도착 시간 기준으로 더 좋은 버전을 고를 수 있다.
  const selectedStations = new Set(
    selectPreciseTargets(
      dedupeByStation(detourPool),
      input.mode,
      input.vehicle,
    ).map((item) => item.station.id),
  );
  const preciseTargets = detourPool.filter((item) =>
    selectedStations.has(item.station.id),
  );
  const radiusForProgress = finalRadiusM(preciseTargets);
  if (radiusForProgress > T2_MAX)
    onProgress?.({
      type: "progress",
      step: "EXPAND",
      radiusM: radiusForProgress,
    });
  onProgress?.({
    type: "partial",
    data: {
      candidates: finalizeCandidates(
        preciseTargets,
        referencePrice,
        input.vehicle,
        input.mode,
        filters.facilities.length > 0,
      ),
      referencePrice,
      refPriceSource,
      expansion: {
        triggered: radiusForProgress > T2_MAX,
        finalRadiusM: radiusForProgress,
      },
      baseRoutes,
    },
  });
  onProgress?.({ type: "progress", step: "PRECISE" });
  // STAGE 1에서 이미 전 후보를 한 번 실측했다. 경유 경로 호출이 실패한 후보(A8)는
  // 추정치를 유지하고 재호출하지 않는다(ARCHITECTURE.md §5.4).
  let finalDetours = dedupeByStation(
    preciseTargets,
  );
  finalDetours = finalDetours.filter(
    (item) =>
      !exceedsDetourCap({
        detourDistanceM: item.detourDistanceM,
        detourDurationS: item.detourDurationS,
        baseDistanceM: item.route.route.distanceM,
        baseDurationS: item.route.route.durationS,
      }),
  );
  finalDetours = finalDetours.filter((item) => {
    if (item.precise && item.detourDurationS > maxDetourMinutes * 60) {
      budgetDropped.push(item);
      return false;
    }
    return true;
  });
  const radius = finalRadiusM(finalDetours);
  const candidates = finalizeCandidates(
    finalDetours,
    referencePrice,
    input.vehicle,
    input.mode,
    filters.facilities.length > 0,
  ).slice(0, MAX_RESULTS);
  const preciseDropped = budgetDropped.filter((item) => item.precise);
  const basis = preciseDropped.length ? preciseDropped : budgetDropped;
  const result: SearchResult = {
    searchId: crypto.randomUUID(),
    baseRoute,
    baseRoutes,
    candidates,
    referencePrice,
    refPriceSource,
    expansion: { triggered: radius > T2_MAX, finalRadiusM: radius },
    warnings,
    stage: "DETOUR",
    minutesNeededForOneResult:
      candidates.length === 0 && basis.length
        ? Math.ceil(
            Math.min(...basis.map((item) => item.detourDurationS)) / 60 / 5,
          ) * 5
        : null,
  };
  void logSearch(result, {
    durationMs: now.getTime() - startedAt,
    fuel: input.vehicle.fuel,
    filters: input.filters,
    origin: input.origin,
    destination: input.destination,
    routeCalls,
    jsonFallback: deps.jsonFallback,
  }).catch(() => {});
  return result;
}
