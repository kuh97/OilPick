/**
 * domain 타입 → API 계약 타입(wire) 변환.
 * ARCHITECTURE.md §6.1. 라우트 핸들러에 이 변환 로직을 직접 두지 않습니다 —
 * "route handler에 비즈니스 로직 없음" 원칙 (§10 Phase 8 완료 기준).
 */

import type { BaseRoute, Candidate, SearchResult, WGS84Point } from "@/domain/types";
import type {
  WireBaseRoute,
  WireCandidate,
  WirePoint,
  WireSearchResult,
} from "./types";

export function serializePoint(p: WGS84Point): WirePoint {
  return { lat: p.lat, lng: p.lng };
}

export function serializeBaseRoute(route: BaseRoute): WireBaseRoute {
  return {
    distanceM: route.distanceM,
    durationS: route.durationS,
    tollWon: route.tollWon,
    polyline: route.polyline.map(serializePoint),
  };
}

export function serializeCandidate(c: Candidate): WireCandidate {
  const { station } = c;
  return {
    id: station.id,
    name: station.name,
    brand: station.brandCode,
    lat: station.location.lat,
    lng: station.location.lng,
    address: station.addressRoad || station.addressJibun || "",
    tel: station.tel ?? null,
    price: c.price,
    priceUpdatedAt: c.priceUpdatedAt ? c.priceUpdatedAt.toISOString() : null,
    facilities: { ...station.facilities },
    kpetro: station.isKpetro,
    tier: c.tier,
    perpDistanceM: c.dPerp,
    detour: { ...c.detour },
    netSaving: c.netSaving,
    estimatedCost: c.totalCost,
    scores: { ...c.scores },
    reason: c.reason,
  };
}

export function serializeCandidates(candidates: Candidate[]): WireCandidate[] {
  return candidates.map(serializeCandidate);
}

export function serializeSearchResult(result: SearchResult): WireSearchResult {
  return {
    searchId: result.searchId,
    baseRoute: serializeBaseRoute(result.baseRoute),
    expansion: result.expansion,
    referencePrice: result.referencePrice,
    refPriceSource: result.refPriceSource,
    candidates: serializeCandidates(result.candidates),
    warnings: result.warnings,
    stage: result.stage,
    minutesNeededForOneResult: result.minutesNeededForOneResult,
  };
}
