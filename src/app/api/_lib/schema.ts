/**
 * API 요청 바디 검증 — ARCHITECTURE.md §6. zod로 파싱 실패를 400으로 돌려줍니다.
 * infra/opinet/schema.ts와 같은 컨벤션 — 스키마는 여기, 파싱은 각 라우트가 호출합니다.
 */

import { z } from "zod";

export const FuelSchema = z.enum(["GASOLINE", "DIESEL", "LPG"]);
export const FacilitySchema = z.enum(["CAR_WASH", "MAINTENANCE", "CVS"]);
export const ModeSchema = z.enum(["balanced", "minCost", "minDistance"]);
export const TierSchema = z.enum(["T1", "T2", "T3"]);
/** domain/deeplink.ts NaviApp과 동기화 유지 */
export const NaviAppSchema = z.enum(["KAKAO", "NAVER", "TMAP"]);

export const PointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().optional(),
});

export const VehicleSchema = z.object({
  efficiency: z.number().positive(),
  refuelAmount: z.number().positive(),
  timeValue: z.number().nonnegative(),
});

export const FiltersSchema = z.object({
  facilities: z.array(FacilitySchema),
  brands: z.array(z.string()),
  kpetroOnly: z.boolean(),
  selfOnly: z.boolean(),
});

export const SearchRequestSchema = z.object({
  origin: PointSchema,
  destination: PointSchema,
  fuel: FuelSchema,
  filters: FiltersSchema,
  vehicle: VehicleSchema,
  mode: ModeSchema,
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

/**
 * §6.3 문서 예시에는 없지만, netSaving을 계산하려면 주유소 가격(P_s)이 필요합니다.
 * 이 엔드포인트는 오피넷 재조회를 하지 않으므로(§6.3 "카카오 경로 API 1회") 서버가
 * 가격을 새로 알아낼 방법이 없습니다 — 클라이언트가 이미 보고 있는 Candidate.price를
 * 그대로 넘겨받습니다. ARCHITECTURE.md §6.3에도 반영했습니다.
 */
export const DetourRequestSchema = z.object({
  origin: PointSchema,
  destination: PointSchema,
  stationId: z.string().min(1),
  vehicle: VehicleSchema,
  priceStation: z.number().positive(),
  referencePrice: z.number(),
});
export type DetourRequest = z.infer<typeof DetourRequestSchema>;

export const NaviEventSchema = z.object({
  searchId: z.string().min(1),
  app: NaviAppSchema,
  rank: z.number().int().positive(),
  tier: TierSchema,
  netSaving: z.number(),
  detourDistanceM: z.number().nonnegative(),
});
export type NaviEvent = z.infer<typeof NaviEventSchema>;

export const NearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  fuel: FuelSchema,
  sort: z.enum(["price", "distance"]).default("price"),
});
export type NearbyQuery = z.infer<typeof NearbyQuerySchema>;

export const PlaceSearchQuerySchema = z.object({
  q: z.string(),
});

export const ReverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
});
