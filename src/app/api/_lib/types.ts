/**
 * API 계약 타입 — ARCHITECTURE.md §6.1.
 * domain/types.ts의 내부 표현과는 다른, 클라이언트가 보는 wire 타입입니다.
 * 변환은 lib/api/serialize.ts가 맡습니다.
 */

import type { Fuel, Tier, Facility, Mode, RefPriceSource, WarningCode, SearchStage } from "@/domain/types";

export type { Fuel, Tier, Facility, Mode, RefPriceSource, WarningCode, SearchStage };

export interface WirePoint {
  lat: number;
  lng: number;
  name?: string;
}

export interface WireVehicle {
  efficiency: number; // km/L
  refuelAmount: number; // L
  timeValue: number; // 원/분
}

export interface WireFilters {
  facilities: Facility[];
  brands: string[];
  kpetroOnly: boolean;
  selfOnly: boolean;
}

export interface WireWarning {
  code: WarningCode;
  message: string;
}

export interface WireCandidate {
  id: string;
  name: string;
  brand: string;
  lat: number;
  lng: number;
  address: string;
  tel: string | null;
  price: number;
  priceUpdatedAt: string | null; // ISO8601
  facilities: { carWash: boolean; maintenance: boolean; cvs: boolean };
  kpetro: boolean;
  tier: Tier;
  perpDistanceM: number;
  /** tollWon: 이 우회로 추가되는 통행료(원, 정보 표시 전용). 모르면 undefined. */
  detour: { precise: boolean; distanceM: number; durationS: number; tollWon?: number };
  netSaving: number;
  estimatedCost: number;
  scores: { balanced: number; minCost: number; minDistance: number };
  reason: string;
}

export interface WireBaseRoute {
  distanceM: number;
  durationS: number;
  /** 이 경로(추천 코스) 자체의 통행료(원). 어느 후보를 골라도 내는 값 — 후보별 detour.tollWon(추가분)과는 별개. */
  tollWon?: number;
  polyline: WirePoint[];
}

export interface WireExpansion {
  triggered: boolean;
  finalRadiusM: number;
}

export interface WireSearchResult {
  searchId: string;
  baseRoute: WireBaseRoute;
  expansion: WireExpansion;
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  candidates: WireCandidate[];
  warnings: WireWarning[];
  /** 이 결과가 STAGE 1(경로상)인지 STAGE 2(우회)인지 — PRODUCT.md §6.6 */
  stage: SearchStage;
  /** STAGE 2가 0건일 때 한 건이라도 나오는 최소 우회 허용 시간(분). 없으면 null */
  minutesNeededForOneResult: number | null;
}

export interface WirePartial {
  candidates: WireCandidate[];
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  expansion: WireExpansion;
}

/** GET /api/stations/nearby, GET /api/stations/:id — Candidate에서 경로 의존 필드를 뺀 형태 (§6.4) */
export interface WireStationSummary {
  id: string;
  name: string;
  brand: string;
  lat: number;
  lng: number;
  address: string;
  tel: string | null;
  price: number | null; // DB에 가격 스냅샷이 없을 수 있음 (§7.1 폴백 C)
  priceUpdatedAt: string | null;
  facilities: { carWash: boolean; maintenance: boolean; cvs: boolean };
  kpetro: boolean;
}

/**
 * GET /api/stations/nearby 전용 — 직선거리 추가.
 * `price`는 반경검색 스냅샷이라 항상 존재합니다(A3로 가격 없는 후보는 이미 제외됨) —
 * WireStationSummary와 달리 non-null로 좁힙니다.
 */
export interface WireNearbyStation extends Omit<WireStationSummary, "price"> {
  price: number;
  distanceM: number;
}

export interface WirePlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
}
