/**
 * 오케스트레이터 — 카카오의 내비추천·최소시간·거리우선 기본 경로를 비교한다.
 * 검색에서는 DB 공간 후보와 표준 도로 링크 방향으로 후보를 정리하고, 후보별 경유
 * 경로는 주유소 상세 화면의 /api/detour에서만 계산한다. 진행 콜백 유무와 무관하게
 * 같은 결과를 만든다.
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
  classifyRoadLinkDirections,
  routeHeadingAtPoint,
  type RoadAccessDirection,
} from "@/domain/road-direction";
import {
  ON_ROUTE_CORRIDOR_MAX_M,
  T2_MAX,
  T3_MAX,
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
import { findNearestRoadLinkProbes } from "@/infra/db/repositories";

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
  findNearestRoadLinkProbes?: typeof findNearestRoadLinkProbes;
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
  accessDirection: RoadAccessDirection;
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
      accessDirection: "UNKNOWN",
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

/** 동일 주유소는 추정 우회 시간·거리, 기본 경로 우선순위 순으로 하나만 남긴다. */
function isBetterVariant(
  next: InternalCandidate,
  current: InternalCandidate,
): boolean {
  const comparisons: Array<[number, number]> = [
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
      precise: item.ic.precise,
      hasFacilityMatch: hasFacilityFilter,
      mode,
    }),
    priceUpdatedAt: pricedOnToDate(item.ic.pricedOn),
    routePriority: item.ic.route.priority,
  }));
}

async function classifyAccessDirections(
  internal: InternalCandidate[],
  db: Db,
  findProbes: typeof findNearestRoadLinkProbes,
): Promise<InternalCandidate[]> {
  const stationPoints = [
    ...new Map(
      internal.map((item) => [
        item.station.id,
        {
          stationId: item.station.id,
          point: wgs84ToProjected(item.station.location),
        },
      ]),
    ).values(),
  ];
  const probes = await findProbes(stationPoints, db);
  const probeByStation = new Map(probes.map((probe) => [probe.stationId, probe]));

  return internal.map((item) => {
    const point = wgs84ToProjected(item.station.location);
    const routePolyline = item.route.route.polyline.map(wgs84ToProjected);
    const routeHeading = routeHeadingAtPoint(point, routePolyline);
    const probe = probeByStation.get(item.station.id);
    const accessDirection = classifyRoadLinkDirections(
      routeHeading,
      probe ? [probe.headingRad] : [],
    );
    return {
      ...item,
      accessDirection,
      tier:
        accessDirection === "SAME_DIRECTION" &&
        item.dPerp <= ON_ROUTE_CORRIDOR_MAX_M
          ? "ON_ROUTE"
          : "DETOUR",
    };
  });
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
  let internal = collected.flatMap(({ route, collected: found }) =>
    toInternalCandidates(found.stations, route),
  );
  const findProbes =
    deps.findNearestRoadLinkProbes ?? findNearestRoadLinkProbes;
  internal = await classifyAccessDirections(internal, db, findProbes);
  // 반대 방향 링크는 경로상으로 승격하지 않지만, 실제 우회 경로가
  // 가능할 수 있으므로 STAGE 2 후보로 보존한다.
  const onRoute = dedupeByStation(
    internal.filter((item) => item.tier === "ON_ROUTE"),
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

  // 어느 기본 경로에서든 경로상 후보가 있으면 우회 탐색은 하지 않는다.
  if (onRoute.length > 0) {
    onProgress?.({ type: "progress", step: "PRECISE" });
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
  const finalDetours = dedupeByStation(detourPool).filter(
    (item) =>
      !exceedsDetourCap({
        detourDistanceM: item.detourDistanceM,
        detourDurationS: item.detourDurationS,
        baseDistanceM: item.route.route.distanceM,
        baseDurationS: item.route.route.durationS,
      }),
  );
  const radiusForProgress = finalRadiusM(finalDetours);
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
        finalDetours,
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
  const radius = finalRadiusM(finalDetours);
  const candidates = finalizeCandidates(
    finalDetours,
    referencePrice,
    input.vehicle,
    input.mode,
    filters.facilities.length > 0,
  ).slice(0, MAX_RESULTS);
  const basis = budgetDropped;
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
