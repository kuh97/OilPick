/**
 * 카카오모빌리티 길찾기 · 카카오 로컬 API 응답 zod 스키마.
 * ARCHITECTURE.md §5.2
 */

import { z } from "zod";

// ─── 길찾기 ───────────────────────────────────────────────────────────────────

export const KakaoRoutePointSchema = z.object({
  name: z.string(),
  x: z.number(), // 경도
  y: z.number(), // 위도
});

export const KakaoRoadSchema = z.object({
  name: z.string(),
  distance: z.number(),
  duration: z.number(),
  // vertexes: [lng1, lat1, lng2, lat2, ...] — 평탄화된 좌표 배열
  vertexes: z.array(z.number()),
});

export const KakaoSectionSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  roads: z.array(KakaoRoadSchema),
});

// 통행료. 응답엔 항상 오지만, 안 오는 변형이 있어도 fetchDirections가 죽지 않도록
// optional로 둔다 — mapper.ts에서 ?? 0으로 안전하게 기본값을 준다.
export const KakaoFareSchema = z.object({
  taxi: z.number(),
  toll: z.number(),
});

export const KakaoRouteSummarySchema = z.object({
  origin: KakaoRoutePointSchema,
  destination: KakaoRoutePointSchema,
  waypoints: z.array(KakaoRoutePointSchema),
  distance: z.number(), // m
  duration: z.number(), // 초
  fare: KakaoFareSchema.optional(),
});

export const KakaoRouteSchema = z.object({
  result_code: z.number(),
  result_msg: z.string(),
  summary: KakaoRouteSummarySchema,
  sections: z.array(KakaoSectionSchema),
});

export const KakaoDirectionsResponseSchema = z.object({
  trans_id: z.string(),
  routes: z.array(KakaoRouteSchema),
});

// ─── 로컬 키워드 검색 ─────────────────────────────────────────────────────────

export const KakaoPlaceDocumentSchema = z.object({
  id: z.string(),
  place_name: z.string(),
  address_name: z.string(),
  road_address_name: z.string().optional(),
  phone: z.string().optional(),
  x: z.string(), // 경도 — 문자열로 내려옴 (길찾기 API와 다름)
  y: z.string(), // 위도 — 문자열로 내려옴
});

export const KakaoLocalSearchResponseSchema = z.object({
  documents: z.array(KakaoPlaceDocumentSchema),
  meta: z.object({
    total_count: z.number(),
    pageable_count: z.number(),
    is_end: z.boolean(),
  }),
});

// ─── 좌표 → 주소 (역지오코딩) ─────────────────────────────────────────────────

export const KakaoAddressSchema = z
  .object({
    address_name: z.string(),
  })
  .nullable();

export const KakaoRoadAddressSchema = z
  .object({
    address_name: z.string(),
  })
  .nullable();

export const KakaoCoord2AddressDocumentSchema = z.object({
  address: KakaoAddressSchema,
  road_address: KakaoRoadAddressSchema,
});

export const KakaoCoord2AddressResponseSchema = z.object({
  documents: z.array(KakaoCoord2AddressDocumentSchema),
});

// ─── 주소 → 좌표 (정방향 지오코딩, CSV 마스터 임포트용) ────────────────────────
// docs/MIGRATION-DB.md §4 — 오피넷 유가 CSV엔 좌표가 없어 이 API로 채웁니다.

export const KakaoAddressSearchDocumentSchema = z.object({
  address_name: z.string(),
  x: z.string(), // 경도 — 문자열로 내려옴
  y: z.string(), // 위도 — 문자열로 내려옴
});

export const KakaoAddressSearchResponseSchema = z.object({
  documents: z.array(KakaoAddressSearchDocumentSchema),
});

export type KakaoFare = z.infer<typeof KakaoFareSchema>;
export type KakaoRoutePoint = z.infer<typeof KakaoRoutePointSchema>;
export type KakaoRoute = z.infer<typeof KakaoRouteSchema>;
export type KakaoDirectionsResponse = z.infer<typeof KakaoDirectionsResponseSchema>;
export type KakaoPlaceDocument = z.infer<typeof KakaoPlaceDocumentSchema>;
export type KakaoCoord2AddressDocument = z.infer<typeof KakaoCoord2AddressDocumentSchema>;
export type KakaoAddressSearchDocument = z.infer<typeof KakaoAddressSearchDocumentSchema>;
