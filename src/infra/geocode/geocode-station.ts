/**
 * 주유소 1곳 좌표 조달 — 카카오 주소검색 → 실패 시 키워드검색.
 * docs/MIGRATION-DB.md §4. Phase A 최초 구축(scripts/import-price-csv.ts)과
 * Phase D 일일 갱신(services/price-import-service.ts)이 공유합니다.
 *
 * 실측 오차: 주소검색 중앙값 15m · 최대 74m ≪ T1_MAX(500m) — 티어 분류 영향 없음.
 */

import { geocodeAddress, fetchPlaces } from "@/infra/kakao/local";

export type CoordSource = "OPINET" | "KAKAO_ADDR" | "KAKAO_KEYWORD";

export interface GeocodeResult {
  lat: number;
  lng: number;
  coordSource: CoordSource;
}

export interface GeocodeInput {
  /** 도로명 주소 (없으면 지번) */
  address: string;
  /** 상호 — 키워드검색 폴백에 씀 */
  name: string;
}

/**
 * 주소검색을 먼저 시도하고, 실패하면 `{시/도} {상호}` 키워드검색으로 폴백합니다.
 * 둘 다 실패하면 null — 좌표 없이는 티어 분류가 불가능하므로 호출부가 이 행을
 * 임포트에서 제외합니다(§4 "검색 후보에서 자동 제외").
 */
export async function geocodeStation(input: GeocodeInput): Promise<GeocodeResult | null> {
  try {
    const viaAddress = await geocodeAddress({ query: input.address });
    if (viaAddress) {
      return { lat: viaAddress.lat, lng: viaAddress.lng, coordSource: "KAKAO_ADDR" };
    }
  } catch {
    // 폴백으로 진행
  }
  try {
    const region = input.address.split(" ")[0] || "";
    const [viaKeyword] = await fetchPlaces({ query: `${region} ${input.name}`, size: 1 });
    if (viaKeyword) {
      return {
        lat: viaKeyword.location.lat,
        lng: viaKeyword.location.lng,
        coordSource: "KAKAO_KEYWORD",
      };
    }
  } catch {
    // 둘 다 실패
  }
  return null;
}
