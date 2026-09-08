/**
 * 카카오 원본 필드 → 도메인 타입 변환.
 * ARCHITECTURE.md §5.2
 */

import { wgs84 } from "@/domain/types";
import type { BaseRoute, PlaceResult, WGS84Point } from "@/domain/types";
import type {
  KakaoRoute,
  KakaoPlaceDocument,
  KakaoCoord2AddressDocument,
  KakaoAddressSearchDocument,
} from "./schema";

/**
 * sections[].roads[].vertexes(경도·위도 평탄화 배열)를 순서대로 이어붙여
 * 하나의 WGS84 폴리라인으로 만듭니다.
 * vertexes는 [lng, lat, lng, lat, ...] 순서입니다 — 뒤집으면 전국이 어긋납니다.
 */
function extractPolyline(route: KakaoRoute): WGS84Point[] {
  const points: WGS84Point[] = [];
  for (const section of route.sections) {
    for (const road of section.roads) {
      for (let i = 0; i + 1 < road.vertexes.length; i += 2) {
        points.push(wgs84(road.vertexes[i + 1], road.vertexes[i]));
      }
    }
  }
  return points;
}

/**
 * 카카오 길찾기 응답 1개 route → BaseRoute.
 * 기본 경로(R₀)·경유 경로(R_s) 양쪽 모두 이 함수를 씁니다 — 구조가 동일합니다.
 */
export function mapDirectionsRoute(route: KakaoRoute): BaseRoute {
  return {
    distanceM: route.summary.distance,
    durationS: route.summary.duration,
    tollWon: route.summary.fare?.toll ?? 0,
    polyline: extractPolyline(route),
  };
}

/**
 * 카카오 로컬 검색 결과 1건 → PlaceResult.
 * 주소는 도로명 우선, 없으면 지번 — RefuelPoint와 동일한 우선순위(PRODUCT.md §6.2).
 */
export function mapPlaceDocument(doc: KakaoPlaceDocument): PlaceResult {
  return {
    name: doc.place_name,
    address: doc.road_address_name || doc.address_name,
    location: wgs84(Number(doc.y), Number(doc.x)),
  };
}

/**
 * 카카오 좌표→주소 변환(coord2address) 응답 1건 → PlaceResult.
 * 응답에 place_name이 없으므로 주소 문자열 자체를 name으로 쓴다 — 도로명 우선, 없으면 지번.
 * 좌표는 응답에 내려오지 않아 요청에 쓴 point를 그대로 채운다.
 */
export function mapCoord2AddressDocument(doc: KakaoCoord2AddressDocument, point: WGS84Point): PlaceResult {
  const address = doc.road_address?.address_name || doc.address?.address_name || "";
  return {
    name: address,
    address,
    location: point,
  };
}

/**
 * 카카오 주소검색(address.json) 결과 1건 → WGS84Point.
 * docs/MIGRATION-DB.md §4 — 유가 CSV 마스터 임포트의 좌표 조달용(정방향 지오코딩).
 */
export function mapAddressSearchDocument(doc: KakaoAddressSearchDocument): WGS84Point {
  return wgs84(Number(doc.y), Number(doc.x));
}
