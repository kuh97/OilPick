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
import { findNearestRoadLinkProbes } from "@/infra/db/repositories";
import { env } from "@/infra/env";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import {
  classifyRoadLinkDirections,
  routeHeadingAtPoint,
} from "@/domain/road-direction";
import {
  isOutOfRange,
  classifyByDetour,
  detourSearchRadiusM,
} from "@/domain/tier";
import { computeDetourFromRoutes } from "@/domain/detour";
import {
  netSaving,
  totalCost,
  computeScores,
  exceedsDetourCap,
  scoreByMode,
} from "@/domain/pricing";
import { buildReason } from "@/domain/reason";
import {
  T2_MAX,
  ON_ROUTE_PREFILTER_MAX_M,
  MAX_RESULTS,
  MIN_ROUTE_DISTANCE,
  DEFAULT_MAX_DETOUR_DISTANCE_KM,
  VALHALLA_ROUTE_CONCURRENCY,
  VALHALLA_TIMEOUT_MS,
  VALHALLA_CACHE_TTL_S,
} from "@/domain/params";
import { valhallaRouteKey, valhallaTraceRouteKey } from "@/infra/cache/keys";
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
import { wgs84 } from "@/domain/types";
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
  maxDistanceM: number,
): InternalCandidate[] {
  const projectedPolyline = route.route.polyline.map(wgs84ToProjected);
  const result: InternalCandidate[] = [];
  for (const { station, price, pricedOn } of stations) {
    const dPerp = pointToPolylineDistanceM(
      wgs84ToProjected(station.location),
      projectedPolyline,
    );
    if (dPerp > maxDistanceM || isOutOfRange(dPerp)) continue;
    result.push({
      station,
      price,
      pricedOn,
      route,
      dPerp,
      tier: "DETOUR",
      // Valhalla 실측 전에는 우회량을 확정하지 않는다.
      detourDistanceM: 0,
      detourDurationS: 0,
      precise: false,
    });
  }
  return result;
}

async function collectInternalCandidates(
  routes: readonly RouteVariant[],
  options: {
    marginM: number;
    maxDistanceM: number;
    fuel: SearchInput["vehicle"]["fuel"];
    filters: {
      facilities: SearchInput["filters"]["facilities"];
      brands: SearchInput["filters"]["brands"];
      kpetroOnly: boolean;
      selfOnly: boolean;
    };
    now: Date;
    db: Db;
  },
): Promise<InternalCandidate[]> {
  const collected = await Promise.all(
    routes.map(async (route) => ({
      route,
      collected: await collectStations({
        referencePoints: route.route.polyline.map(wgs84ToProjected),
        marginM: options.marginM,
        fuel: options.fuel,
        filters: options.filters,
        now: options.now,
        db: options.db,
      }),
    })),
  );
  return collected.flatMap(({ route, collected: found }) =>
    toInternalCandidates(found.stations, route, options.maxDistanceM),
  );
}

function candidateKey(item: InternalCandidate): string {
  return `${item.station.id}:${routeFingerprint(item.route.route)}`;
}

function dedupeByCandidateKey(
  pool: readonly InternalCandidate[],
): InternalCandidate[] {
  const seen = new Set<string>();
  return pool.filter((item) => {
    const key = candidateKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

/**
 * STAGE 1 후보가 Valhalla의 짧은 우회만으로 경로상으로 오표시되지 않게 한다.
 * 방향 데이터가 없거나 계산할 수 없으면 기존 실측 결과를 보존한다 — 표준
 * 링크에는 주유소 진입구가 없기 때문이다.
 */
async function applyRoadDirectionGate(
  candidates: readonly InternalCandidate[],
  db: Db,
): Promise<InternalCandidate[]> {
  if (candidates.length === 0) return [];

  const stationPoints = [
    ...new Map(
      candidates.map((candidate) => [
        candidate.station.id,
        {
          stationId: candidate.station.id,
          point: wgs84ToProjected(candidate.station.location),
        },
      ]),
    ).values(),
  ];

  let probes: Awaited<ReturnType<typeof findNearestRoadLinkProbes>>;
  try {
    probes = await findNearestRoadLinkProbes(stationPoints, db);
  } catch {
    // 방향 보조 데이터 장애가 검색 전체를 중단시키지 않도록 UNKNOWN으로 보존한다.
    return [...candidates];
  }

  const probeByStationId = new Map(probes.map((probe) => [probe.stationId, probe]));

  return candidates.map((candidate) => {
    if (candidate.tier !== "ON_ROUTE") return candidate;

    const probe = probeByStationId.get(candidate.station.id);
    if (!probe) return candidate;

    const routeHeading = routeHeadingAtPoint(
      wgs84ToProjected(candidate.station.location),
      candidate.route.route.polyline.map(wgs84ToProjected),
    );
    const direction = classifyRoadLinkDirections(routeHeading, [probe.headingRad]);
    if (direction !== "OPPOSITE_DIRECTION") return candidate;

    return { ...candidate, tier: "DETOUR" };
  });
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
    const byMode =
      priceRefWon == null
        ? a.ic.price - b.ic.price
        : scoreByMode(a.scores, mode) - scoreByMode(b.scores, mode);
    if (byMode !== 0) return byMode;
    const byPrecise = Number(b.ic.precise) - Number(a.ic.precise);
    if (byPrecise !== 0) return byPrecise;
    return a.ic.station.id.localeCompare(b.ic.station.id);
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
      netSavingWon: priceRefWon == null ? null : item.netSavingWon,
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
    redis: RedisLike;
    prefix: string;
    baseUrl?: string;
    timeoutMs: number;
    concurrency: number;
    signal?: AbortSignal;
  },
): Promise<BaselineResult[]> {
  return mapWithConcurrency(routes, options.concurrency, async (variant) => {
    const key = valhallaTraceRouteKey(options.prefix, variant.route.polyline);
    const cached = await getCachedValhallaRoute(options.redis, key);
    if (cached) return { key: routeFingerprint(variant.route), route: cached };

    try {
      const route = await mapMatchValhallaRoute({
        polyline: variant.route.polyline,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      await cacheValhallaRoute(options.redis, key, route);
      return {
        key: routeFingerprint(variant.route),
        route,
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
    redis: RedisLike;
    prefix: string;
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

    const key = valhallaRouteKey(
      options.prefix,
      options.origin,
      options.destination,
      item.station.location,
    );
    const cached = await getCachedValhallaRoute(options.redis, key);
    if (cached) {
      const detour = computeDetourFromRoutes(baseline, cached);
      return {
        candidate: {
          ...item,
          tier: classifyByDetour(detour.durationS, detour.distanceM),
          detourDistanceM: detour.distanceM,
          detourDurationS: detour.durationS,
          precise: false,
          viaDistanceM: cached.distanceM,
          viaDurationS: cached.durationS,
        },
      };
    }

    try {
      const viaRoute = await fetchValhallaRoute({
        origin: options.origin,
        destination: options.destination,
        waypoint: item.station.location,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      await cacheValhallaRoute(options.redis, key, viaRoute);
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

function finalDetourRadiusM(
  items: ReadonlyArray<{ dPerp: number; tier: Tier }>,
): number {
  const detours = items.filter((item) => item.tier === "DETOUR");
  return detours.length
    ? Math.max(...detours.map((item) => item.dPerp))
    : 0;
}

/** 경로상 후보는 전부 보존하고, 우회 후보에만 화면 상한을 적용한다. */
function limitDetourCandidates(candidates: Candidate[]): Candidate[] {
  let detourCount = 0;
  return candidates.filter((candidate) => {
    if (candidate.tier === "ON_ROUTE") return true;
    detourCount += 1;
    return detourCount <= MAX_RESULTS;
  });
}

interface CachedBaseRoute {
  distanceM: number;
  durationS: number;
  polyline: Array<{ lat: number; lng: number }>;
}

function serializeValhallaRoute(route: BaseRoute): string {
  const cached: CachedBaseRoute = {
    distanceM: route.distanceM,
    durationS: route.durationS,
    polyline: route.polyline.map((point) => ({ lat: point.lat, lng: point.lng })),
  };
  return JSON.stringify(cached);
}

function deserializeValhallaRoute(raw: string): BaseRoute {
  const cached = JSON.parse(raw) as CachedBaseRoute;
  return {
    distanceM: cached.distanceM,
    durationS: cached.durationS,
    polyline: cached.polyline.map((point) => wgs84(point.lat, point.lng)),
  };
}

async function getCachedValhallaRoute(
  redis: RedisLike,
  key: string,
): Promise<BaseRoute | null> {
  const cached = await redis.get(key);
  if (!cached) return null;
  try {
    return deserializeValhallaRoute(cached);
  } catch {
    return null;
  }
}

async function cacheValhallaRoute(
  redis: RedisLike,
  key: string,
  route: BaseRoute,
): Promise<void> {
  await redis.set(key, serializeValhallaRoute(route), { ex: VALHALLA_CACHE_TTL_S });
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
  // STAGE 1은 경로상 후보를 놓치지 않도록 좁은 사전 범위만 조회한다.
  const stage1Internal = await collectInternalCandidates(baseRoutes, {
    marginM: ON_ROUTE_PREFILTER_MAX_M,
    maxDistanceM: ON_ROUTE_PREFILTER_MAX_M,
    fuel: input.vehicle.fuel,
    filters,
    now,
    db,
  });
  // P_ref는 기존 계약대로 d_perp ≤ T2_MAX 전체의 가격 표본을 사용한다.
  // 이 조회 결과는 기준가 계산 전용이며 Valhalla 후보 측정에는 사용하지 않는다.
  const referencePool = dedupeForReference(
    await collectInternalCandidates(baseRoutes, {
      marginM: T2_MAX,
      maxDistanceM: T2_MAX,
      fuel: input.vehicle.fuel,
      filters,
      now,
      db,
    }),
  );
  deps.signal?.throwIfAborted();
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

  const valhallaTimeoutMs = deps.valhallaTimeoutMs ?? VALHALLA_TIMEOUT_MS;
  const valhallaConcurrency =
    deps.valhallaConcurrency ?? VALHALLA_ROUTE_CONCURRENCY;
  const baselineResults = await mapMatchBaseRoutes(baseRoutes, {
    redis,
    prefix,
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
  const stage1MeasuredResults = await measureCandidates(stage1Internal, baselines, {
    redis,
    prefix,
    origin: input.origin,
    destination: input.destination,
    baseUrl: deps.valhallaBaseUrl,
    timeoutMs: valhallaTimeoutMs,
    concurrency: valhallaConcurrency,
    signal: deps.signal,
  });
  const stage1Measured = stage1MeasuredResults.flatMap((result) =>
    result.candidate ? [result.candidate] : [],
  );
  let measured = await applyRoadDirectionGate(stage1Measured, db);
  const emitValhallaWarning = (
    failureCount: number,
    measuredCount: number,
  ): void => {
    if (
      failureCount <= 0 ||
      warnings.some(
        (warning) =>
          warning.code === "VALHALLA_PARTIAL" ||
          warning.code === "VALHALLA_UNAVAILABLE",
      )
    )
      return;
    const warning: Warning = {
      code: measuredCount > 0 ? "VALHALLA_PARTIAL" : "VALHALLA_UNAVAILABLE",
      message:
        measuredCount > 0
          ? "일부 후보의 실제 경로를 확인하지 못해 결과에서 제외했습니다."
          : "실제 경로를 확인하지 못해 후보를 표시할 수 없습니다.",
    };
    warnings.push(warning);
    onProgress?.({ type: "warning", data: warning });
  };

  // STAGE 1 경로상 후보는 우회 옵션과 무관하게 항상 보존한다.
  const onRoute = dedupeByStation(
    measured.filter((item) => item.tier === "ON_ROUTE"),
  );
  const buildOnRouteResult = (items: InternalCandidate[]): SearchResult => ({
    searchId: crypto.randomUUID(),
    baseRoute,
    baseRoutes,
    candidates: finalizeCandidates(
      dedupeByStation(items),
      referencePrice,
      input.vehicle,
      input.mode,
      filters.facilities.length > 0,
    ),
    referencePrice,
    refPriceSource,
    expansion: { triggered: false, finalRadiusM: 0 },
    warnings,
    stage: "ON_ROUTE",
    distanceNeededForOneResultKm: null,
  });
  const selectedDetourDistanceKm =
    input.includeDetour === true ? input.maxDetourDistanceKm : undefined;
  if (onRoute.length > 0 && selectedDetourDistanceKm == null) {
    const stage1FailureCount =
      baselineResults.filter((result) => result.route == null).length +
      dedupeByCandidateKey(stage1Internal).length -
      new Set(stage1Measured.map(candidateKey)).size;
    emitValhallaWarning(stage1FailureCount, measured.length);
    onProgress?.({ type: "progress", step: "PRECISE" });
    const result = buildOnRouteResult(onRoute);
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

  const maxDetourDistanceKm =
    selectedDetourDistanceKm ?? DEFAULT_MAX_DETOUR_DISTANCE_KM;
  const maxDetourDistanceM = maxDetourDistanceKm * 1000;
  const detourSearchRadiusMValue = detourSearchRadiusM(maxDetourDistanceM);

  // 사용자가 우회 거리를 선택했거나 경로상 후보가 없으면 선택 거리 + 3km까지 넓힌다.
  // 경로상 후보가 없고 명시 선택도 없으면 기존 기본값 5km를 적용한다.
  // STAGE 1 측정값은 재사용하고, 새 후보만 Valhalla로 추가 측정한다.
  onProgress?.({ type: "progress", step: "EXPAND", radiusM: detourSearchRadiusMValue });

  const expandedInternal = await collectInternalCandidates(baseRoutes, {
    marginM: detourSearchRadiusMValue,
    maxDistanceM: detourSearchRadiusMValue,
    fuel: input.vehicle.fuel,
    filters,
    now,
    db,
  });
  const stage1AttemptedKeys = new Set(stage1Internal.map(candidateKey));
  const expansionInternal = expandedInternal.filter(
    (item) => !stage1AttemptedKeys.has(candidateKey(item)),
  );
  const expansionMeasuredResults = await measureCandidates(
    expansionInternal,
    baselines,
    {
      redis,
      prefix,
      origin: input.origin,
      destination: input.destination,
      baseUrl: deps.valhallaBaseUrl,
      timeoutMs: valhallaTimeoutMs,
      concurrency: valhallaConcurrency,
      signal: deps.signal,
    },
  );
  // STAGE 2는 우회 탐색 결과다. Valhalla가 ΔT·ΔD를 작게 계산하더라도
  // STAGE 1의 300m 사전 범위를 벗어난 후보를 경로상으로 승격하지 않는다.
  const expansionMeasured = expansionMeasuredResults.flatMap((result) =>
    result.candidate
      ? [{ ...result.candidate, tier: "DETOUR" as const }]
      : [],
  );
  measured = [...measured, ...expansionMeasured];
  const allInternal = dedupeByCandidateKey([
    ...stage1Internal,
    ...expandedInternal,
  ]);
  const failureCount =
    baselineResults.filter((result) => result.route == null).length +
    allInternal.length -
    new Set(measured.map(candidateKey)).size;
  emitValhallaWarning(failureCount, measured.length);
  onProgress?.({ type: "progress", step: "PRECISE" });

  const onRouteStationIds = new Set(onRoute.map((item) => item.station.id));
  const distanceDropped = measured.filter(
    (item) =>
      item.tier === "DETOUR" &&
      !onRouteStationIds.has(item.station.id) &&
      item.detourDistanceM > maxDetourDistanceM,
  );
  // 실제 허용 거리 안에 있고 안전 상한을 넘지 않는 후보는 모두 남긴다.
  // NetSaving은 카드의 이득/손해 표시 기준이지, 후보 삭제나 티어 우선 정렬 기준이 아니다.
  const detourPool = measured.filter(
    (item) =>
      item.tier === "DETOUR" &&
      !onRouteStationIds.has(item.station.id) &&
      item.detourDistanceM <= maxDetourDistanceM,
  );
  const finalDetours = dedupeByStation(detourPool).filter(
    (item) =>
      !exceedsDetourCap({
        detourDistanceM: item.detourDistanceM,
        detourDurationS: item.detourDurationS,
        baseDistanceM: item.route.route.distanceM,
        baseDurationS: item.route.route.durationS,
      }),
  );
  const partialCandidates = finalizeCandidates(
    dedupeByStation([...onRoute, ...finalDetours]),
    referencePrice,
    input.vehicle,
    input.mode,
    filters.facilities.length > 0,
  );
  const partialRadiusM = finalDetourRadiusM(partialCandidates);
  const hasPartialDetourCandidates = partialCandidates.some(
    (candidate) => candidate.tier === "DETOUR",
  );
  onProgress?.({
    type: "partial",
    data: {
      candidates: partialCandidates,
      referencePrice,
      refPriceSource,
      expansion: {
        triggered: hasPartialDetourCandidates,
        finalRadiusM: partialRadiusM,
      },
      baseRoutes,
    },
  });
  const candidates = limitDetourCandidates(partialCandidates);
  const radius = finalDetourRadiusM(candidates);
  const hasDetourCandidates = candidates.some(
    (candidate) => candidate.tier === "DETOUR",
  );
  const result: SearchResult = {
    searchId: crypto.randomUUID(),
    baseRoute,
    baseRoutes,
    candidates,
    referencePrice,
    refPriceSource,
    expansion: { triggered: hasDetourCandidates, finalRadiusM: radius },
    warnings,
    stage: "DETOUR",
    distanceNeededForOneResultKm:
      candidates.length === 0 && distanceDropped.length > 0
        ? Math.ceil(
            Math.min(...distanceDropped.map((item) => item.detourDistanceM)) /
              1000,
          )
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
