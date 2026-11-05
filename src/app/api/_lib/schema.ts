/**
 * API 요청 바디 검증 — ARCHITECTURE.md §6. zod로 파싱 실패를 400으로 돌려줍니다.
 * infra/opinet/schema.ts와 같은 컨벤션 — 스키마는 여기, 파싱은 각 라우트가 호출합니다.
 */

import { z } from "zod";

export const FuelSchema = z.enum(["GASOLINE", "DIESEL", "LPG"]);
export const RoutePrioritySchema = z.enum(["RECOMMEND", "TIME", "DISTANCE"]);
export const FacilitySchema = z.enum(["CAR_WASH", "MAINTENANCE", "CVS"]);
export const ModeSchema = z.enum(["balanced", "minCost", "minDistance"]);
/** 배지 2종 — 경로상 / 우회 (§6.4). */
export const TierSchema = z.enum(["ON_ROUTE", "DETOUR"]);
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
  /** 고속도로·자동차전용도로 회피 — 경로 자체가 바뀌는 검색 조건 (PRODUCT.md §5.1) */
  avoidHighway: z.boolean().default(false),
  /** 기존 클라이언트 호환 필드 — 서버는 경로상 후보가 없으면 STAGE 2를 실행한다 (§6.6) */
  includeDetour: z.boolean().default(false),
  /** "허용 우회 거리"(km) — 검색 파라미터, STAGE 2 전용 */
  maxDetourDistanceKm: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15)]).optional(),
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
  // 검색 때 쓴 값과 같아야 기본 경로와 비교가 맞는다 — 다르면 톨비·거리·시간 델타가
  // 전부 틀어진다.
  avoidHighway: z.boolean().default(false),
  routePriority: RoutePrioritySchema.default("RECOMMEND"),
});
export type DetourRequest = z.infer<typeof DetourRequestSchema>;

/** F10 주변 상세 지도 — 현재 위치에서 주유소까지의 실제 도로 경로 요청 */
export const StationRouteRequestSchema = z.object({
  origin: PointSchema,
  stationId: z.string().min(1),
});
export type StationRouteRequest = z.infer<typeof StationRouteRequestSchema>;

export const NaviEventSchema = z.object({
  searchId: z.string().min(1),
  app: NaviAppSchema,
  rank: z.number().int().positive(),
  tier: TierSchema,
  netSaving: z.number(),
  detourDistanceM: z.number().nonnegative(),
});
export type NaviEvent = z.infer<typeof NaviEventSchema>;

export const FeedbackRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4_000),
  feedbackSource: z
    .enum(["HOME", "NEARBY", "NEARBY_DETAIL", "SEARCH", "SEARCH_DETAIL"])
    .optional(),
  stationId: z.string().trim().min(1).max(100).optional(),
  stationName: z.string().trim().min(1).max(200).optional(),
  searchId: z.string().uuid().optional(),
  originName: z.string().trim().min(1).max(200).optional(),
  destinationName: z.string().trim().min(1).max(200).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const AdminLoginRequestSchema = z.object({
  password: z.string().min(1).max(200),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminFeedbackStatusSchema = z.enum([
  "NEW",
  "IN_PROGRESS",
  "RESOLVED",
]);
export const AdminFeedbackStatusUpdateSchema = z.object({
  status: AdminFeedbackStatusSchema,
});
export const AdminFeedbackQuerySchema = z.object({
  status: AdminFeedbackStatusSchema.optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
});
export type AdminFeedbackStatus = z.infer<typeof AdminFeedbackStatusSchema>;
export const AdminDashboardQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const NearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  fuel: FuelSchema,
  sort: z.enum(["price", "distance"]).default("price"),
  facilities: z.preprocess(
    (value) =>
      typeof value === "string" && value.length > 0 ? value.split(",") : value,
    z.array(FacilitySchema).default([]),
  ),
  brands: z.preprocess(
    (value) =>
      typeof value === "string" && value.length > 0 ? value.split(",") : value,
    z.array(z.string()).default([]),
  ),
  kpetroOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  selfOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type NearbyQuery = z.infer<typeof NearbyQuerySchema>;

export const StationDetailQuerySchema = z.object({
  fuel: FuelSchema.default("GASOLINE"),
});
export type StationDetailQuery = z.infer<typeof StationDetailQuerySchema>;

export const PlaceSearchQuerySchema = z.object({
  q: z.string(),
});

export const ReverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
});

/** 일일 유가 archive 임포트 대상 기준일 — YYYYMMDD. 생략하면 latest 안전망을 사용합니다. */
export const ImportPricesQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{8}$/, "date는 YYYYMMDD 형식이어야 합니다")
    .optional(),
});
export type ImportPricesQuery = z.infer<typeof ImportPricesQuerySchema>;
