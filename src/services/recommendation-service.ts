/**
 * 오케스트레이터 — 카카오의 내비추천·최소시간·거리우선 기본 경로를 비교한다.
 * 검색에서는 DB 공간 후보를 모은 뒤 Valhalla로 기본 경로를 map-match하고 후보별
 * 경유 경로를 계산한다. 최종 상세 경로는 기존처럼 Kakao가 담당한다.
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
  isOutOfRange,
  routeAvgSpeedKmh,
  estimateDetourDurationSAtSpeed,
  classifyByDetour,
} from "@/domain/tier";
import { computeDetourFromRoutes } from "@/domain/detour";
import {
  estimateDetourDistanceM,
  estimateDetourDurationS,
  netSaving,
  totalCost,
  computeScores,
  passesDetourGate,
  gateDetourDistanceM,
  withinDetourBudget,
  withinActualDetourBudget,
  exceedsDetourCap,
  scoreByMode,
} from "@/domain/pricing";
import { buildReason } from "@/domain/reason";
import {
  T2_MAX,
  T3_MAX,
  MAX_RESULTS,
  MIN_ROUTE_DISTANCE,
  DEFAULT_MAX_DETOUR_MINUTES,
  VALHALLA_ROUTE_CONCURRENCY,
  VALHALLA_TIMEOUT_MS,
} from "@/domain/params";
import {
  fetchValhallaRoute,
  mapMatchValhallaRoute,
} from "@/infra/valhalla/client";
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
  signal?: AbortSignal;
  valhallaBaseUrl?: string;
  valhallaTimeoutMs?: number;
  valhallaConcurrency?: number;
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
  precise: boolean;
  viaDistanceM?: number;
  viaDurationS?: number;
}

const BASE_PRIORITIES: readonly RoutePriority[] = [
  "RECOMMEND",
  "TIME",
  "DISTANCE",
];

function priorityRank(priority: RoutePriority): number {
  return BASE_PRIORITIES.indexOf(priority);
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
      tier: "DETOUR",
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

/** 동일 주유소는 실제 총 경로 시간·거리, 실제 우회량, 기본 경로 우선순위 순으로 하나만 남긴다. */
function isBetterVariant(
  next: InternalCandidate,
  current: InternalCandidate,
): boolean {
  const comparisons: Array<[number, number]> = [
    [next.viaDurationS ?? next.detourDurationS, current.viaDurationS ?? current.detourDurationS],
    [next.viaDistanceM ?? next.detourDistanceM, current.viaDistanceM ?? current.detourDistanceM],
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
    const aOnRoute = a.ic.tier === "ON_ROUTE";
    const bOnRoute = b.ic.tier === "ON_ROUTE";
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
      precise: item.ic.precise,
      hasFacilityMatch: hasFacilityFilter,
      mode,
    }),
    priceUpdatedAt: pricedOnToDate(item.ic.pricedOn),
    routePriority: item.ic.route.priority,
  }));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    }),
  );

  return results;
}

interface BaselineResult {
  key: string;
  route: BaseRoute | null;
}

async function mapMatchBaseRoutes(
  routes: readonly RouteVariant[],
  options: {
    baseUrl?: string;
    timeoutMs: number;
    concurrency: number;
    signal?: AbortSignal;
  },
): Promise<BaselineResult[]> {
  return mapWithConcurrency(routes, options.concurrency, async (variant) => {
    try {
      return {
        key: routeFingerprint(variant.route),
        route: await mapMatchValhallaRoute({
          polyline: variant.route.polyline,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        }),
      };
    } catch {
      options.signal?.throwIfAborted();
      return { key: routeFingerprint(variant.route), route: null };
    }
  });
}

interface MeasureResult {
  candidate: InternalCandidate | null;
}

async function measureCandidates(
  candidates: readonly InternalCandidate[],
  baselines: ReadonlyMap<string, BaseRoute>,
  options: {
    origin: SearchInput["origin"];
    destination: SearchInput["destination"];
    baseUrl?: string;
    timeoutMs: number;
    concurrency: number;
    signal?: AbortSignal;
  },
): Promise<MeasureResult[]> {
  return mapWithConcurrency(candidates, options.concurrency, async (item) => {
    const baseline = baselines.get(routeFingerprint(item.route.route));
    if (!baseline) return { candidate: null };

    try {
      const viaRoute = await fetchValhallaRoute({
        origin: options.origin,
        destination: options.destination,
        waypoint: item.station.location,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      const detour = computeDetourFromRoutes(baseline, viaRoute);
      return {
        candidate: {
          ...item,
          tier: classifyByDetour(detour.durationS, detour.distanceM),
          detourDistanceM: detour.distanceM,
          detourDurationS: detour.durationS,
          precise: false,
          viaDistanceM: viaRoute.distanceM,
          viaDurationS: viaRoute.durationS,
        },
      };
    } catch {
      options.signal?.throwIfAborted();
      return { candidate: null };
    }
  });
}

function finalRadiusM(items: ReadonlyArray<{ dPerp: number }>): number {
  return items.length ? Math.max(...items.map((item) => item.dPerp)) : 0;
}

/** 오케스트레이터 본체. */
export async function search(
  input: SearchInput,
  onProgress?: OnProgress,
  deps: SearchDeps = {},
): Promise<SearchResult> {
  deps.signal?.throwIfAborted();
  const redis = deps.redis ?? getRedis();
  const db = deps.db ?? getDb();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const now = deps.now ?? new Date();
  const startedAt = now.getTime();
  const warnings: Warning[] = [];
  const routeCalls = BASE_PRIORITIES.length;

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
        signal: deps.signal,
      }),
    })),
  );
  deps.signal?.throwIfAborted();
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
  deps.signal?.throwIfAborted();
  const internal = collected.flatMap(({ route, collected: found }) =>
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
  deps.signal?.throwIfAborted();
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

  onProgress?.({ type: "progress", step: "PRECISE" });
  const valhallaTimeoutMs = deps.valhallaTimeoutMs ?? VALHALLA_TIMEOUT_MS;
  const valhallaConcurrency =
    deps.valhallaConcurrency ?? VALHALLA_ROUTE_CONCURRENCY;
  const baselineResults = await mapMatchBaseRoutes(baseRoutes, {
    baseUrl: deps.valhallaBaseUrl,
    timeoutMs: valhallaTimeoutMs,
    concurrency: valhallaConcurrency,
    signal: deps.signal,
  });
  const baselines = new Map(
    baselineResults.flatMap((result) =>
      result.route ? [[result.key, result.route] as const] : [],
    ),
  );
  const measuredResults = await measureCandidates(internal, baselines, {
    origin: input.origin,
    destination: input.destination,
    baseUrl: deps.valhallaBaseUrl,
    timeoutMs: valhallaTimeoutMs,
    concurrency: valhallaConcurrency,
    signal: deps.signal,
  });
  const measured = measuredResults.flatMap((result) =>
    result.candidate ? [result.candidate] : [],
  );
  const valhallaFailureCount =
    baselineResults.filter((result) => result.route == null).length +
    measuredResults.filter((result) => result.candidate == null).length;
  if (valhallaFailureCount > 0) {
    const warning: Warning = {
      code: measured.length > 0 ? "VALHALLA_PARTIAL" : "VALHALLA_UNAVAILABLE",
      message:
        measured.length > 0
          ? "일부 후보의 실제 경로를 확인하지 못해 결과에서 제외했습니다."
          : "실제 경로를 확인하지 못해 후보를 표시할 수 없습니다.",
    };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
  }

  // 어느 기본 경로에서든 실제 ΔT·ΔD가 모두 기준 안인 후보가 있으면 우회 탐색은 하지 않는다.
  const onRoute = dedupeByStation(
    measured.filter((item) => item.tier === "ON_ROUTE"),
  );
  if (onRoute.length > 0) {
    const result: SearchResult = {
      searchId: crypto.randomUUID(),
      baseRoute,
      baseRoutes,
      candidates: finalizeCandidates(
        onRoute,
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

  // 경로상 후보가 없어서 STAGE 2에 진입하면 탐색 범위를 T3 회랑까지 넓힌다.
  // T2_MAX는 기준가 표본 경계일 뿐, 범위 확장 여부를 가르는 조건이 아니다.
  onProgress?.({ type: "progress", step: "EXPAND", radiusM: T3_MAX });

  const maxDetourMinutes = input.maxDetourMinutes ?? DEFAULT_MAX_DETOUR_MINUTES;
  let detourPool = measured;
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
  const finalDetours = dedupeByStation(detourPool).filter(
    (item) =>
      withinActualDetourBudget({
        detourDurationS: item.detourDurationS,
        maxDetourMinutes,
      }) &&
      !exceedsDetourCap({
        detourDistanceM: item.detourDistanceM,
        detourDurationS: item.detourDurationS,
        baseDistanceM: item.route.route.distanceM,
        baseDurationS: item.route.route.durationS,
      }),
  );
  const actualBudgetDropped = dedupeByStation(detourPool).filter(
    (item) =>
      !withinActualDetourBudget({
        detourDurationS: item.detourDurationS,
        maxDetourMinutes,
      }),
  );
  const partialCandidates = finalizeCandidates(
    finalDetours,
    referencePrice,
    input.vehicle,
    input.mode,
    filters.facilities.length > 0,
  );
  const partialRadiusM = finalRadiusM(partialCandidates);
  onProgress?.({
    type: "partial",
    data: {
      candidates: partialCandidates,
      referencePrice,
      refPriceSource,
      expansion: {
        triggered: partialCandidates.length > 0,
        finalRadiusM: partialRadiusM,
      },
      baseRoutes,
    },
  });
  const candidates = partialCandidates.slice(0, MAX_RESULTS);
  const radius = finalRadiusM(candidates);
  const basis = [...budgetDropped, ...actualBudgetDropped];
  const result: SearchResult = {
    searchId: crypto.randomUUID(),
    baseRoute,
    baseRoutes,
    candidates,
    referencePrice,
    refPriceSource,
    expansion: { triggered: candidates.length > 0, finalRadiusM: radius },
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
