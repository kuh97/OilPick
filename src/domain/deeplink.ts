/**
 * 외부 내비게이션 딥링크 생성
 * ARCHITECTURE.md §5.5
 *
 * 순수 함수 — URL 문자열만 반환하고 side effect 없음.
 */

import type { WGS84Point } from "./types";

export type NaviApp = "KAKAO" | "NAVER" | "TMAP";

export interface DeeplinkInput {
  app: NaviApp;
  origin: WGS84Point;
  destination: WGS84Point;
  waypoint: WGS84Point;    // 경유 주유소
  originName?: string;
  destinationName?: string;
  waypointName?: string;
  appName?: string;         // 네이버지도 appname 파라미터
}

/**
 * 딥링크 URL 생성.
 * ARCHITECTURE.md §5.5 스킴 정의 기준.
 */
export function buildDeeplink(input: DeeplinkInput): string {
  switch (input.app) {
    case "KAKAO":  return buildKakaoDeeplink(input);
    case "NAVER":  return buildNaverDeeplink(input);
    case "TMAP":   return buildTmapDeeplink(input);
  }
}

function buildKakaoDeeplink(input: DeeplinkInput): string {
  const { origin, destination, waypoint } = input;
  // kakaomap://route?sp={slat},{slng}&ep={elat},{elng}&by=car&vp={vlat},{vlng}
  const params = new URLSearchParams({
    sp: `${origin.lat},${origin.lng}`,
    ep: `${destination.lat},${destination.lng}`,
    by: "car",
    vp: `${waypoint.lat},${waypoint.lng}`,
  });
  return `kakaomap://route?${params.toString()}`;
}

function buildNaverDeeplink(input: DeeplinkInput): string {
  const { origin, destination, waypoint, originName, destinationName, waypointName, appName } = input;
  // nmap://route/car?slat=&slng=&sname=&dlat=&dlng=&dname=&v1lat=&v1lng=&v1name=&appname=
  const params = new URLSearchParams({
    slat: String(origin.lat),
    slng: String(origin.lng),
    sname: originName ?? "",
    dlat: String(destination.lat),
    dlng: String(destination.lng),
    dname: destinationName ?? "",
    v1lat: String(waypoint.lat),
    v1lng: String(waypoint.lng),
    v1name: waypointName ?? "",
    appname: appName ?? "",
  });
  return `nmap://route/car?${params.toString()}`;
}

function buildTmapDeeplink(input: DeeplinkInput): string {
  const { waypoint, waypointName } = input;
  // 티맵은 경유지를 전달할 수 없으므로 주유소를 목적지로 넣습니다 (PRODUCT.md §5.5).
  // 최종 목적지는 주유 후 사용자가 다시 입력합니다 — UI에 그 안내를 붙입니다.
  // 경유지 파라미터(rV1*)는 실기기에서 무시됨을 확인 (ARCHITECTURE.md §12 ⑧, 2026-08-28).
  const params = new URLSearchParams({
    rGoName: waypointName ?? "",
    rGoX: String(waypoint.lng),
    rGoY: String(waypoint.lat),
  });
  return `tmap://route?${params.toString()}`;
}

// 네이버 New Map(map.naver.com/p) 좌표 인코딩 — 실제 사용자가 카카오맵과 동일하게
// "출발→경유 추가"로 만든 공유 링크를 역공학해 확인함(2026-08-31). 위경도를 1e7배해
// 반올림한 정수에 20억을 더한 뒤(항상 양수로 만들기 위한 오프셋으로 추정) 62진법
// (0-9a-zA-Z 순서 알파벳)으로 인코딩한다. 우리 DB의 정확한 좌표(대성산업성남충전소)로
// 검증했을 때 실제 링크의 토큰과 완전히 일치했다.
const NAVER_COORD_OFFSET = 2_000_000_000;
const NAVER_BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encodeNaverCoord(degrees: number): string {
  let n = Math.round(degrees * 1e7) + NAVER_COORD_OFFSET;
  if (n <= 0) return NAVER_BASE62_ALPHABET[0];
  let result = "";
  while (n > 0) {
    result = NAVER_BASE62_ALPHABET[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

/** 네이버 New Map 길찾기 URL의 지점 1개 세그먼트: {x},{y},{name},{poiId},{type} — poiId는 비워도 된다. */
function naverStopSegment(point: WGS84Point, name: string): string {
  return `${encodeNaverCoord(point.lng)},${encodeNaverCoord(point.lat)},${encodeURIComponent(name)},,SIMPLE_POI`;
}

/**
 * PC 웹 폴백 URL 생성 — 앱 스킴을 처리할 수 없는 데스크톱 브라우저용.
 * 티맵은 웹 길찾기를 제공하지 않아 null.
 *
 * 카카오: 공식 웹 API 가이드(https://apis.map.kakao.com/web/guide/) 문서화된
 * `/link/by/{car|traffic|walk|bicycle}/{stop1}/.../{stopN}` 포맷 — 경유지 최대 5개 지원.
 * 실제 판교역→양재역(경유)→강남역으로 3구간 라우팅되는 것을 확인함 — 출발→경유→최종
 * 목적지 전체 안내.
 *
 * 네이버: `map.naver.com/p/directions/{stop1}/{stop2}/{stop3}/car` — 카카오와 달리
 * "첫 지점=출발, 두 번째=도착, 그 뒤(세 번째부터)=경유" 순서다. 처음엔 카카오처럼
 * 마지막=도착이라고 추측해 출발→경유→도착으로 넣었더니 실기기에서 출발-도착-경유로
 * 해석됨을 확인(2026-08-31) — 즉 두 번째 자리가 항상 도착이고, 경유지는 그 뒤에
 * 추가로 붙는다. 그래서 출발/도착을 먼저, 경유를 마지막에 넣도록 순서를 맞췄다.
 */
export function buildWebFallbackUrl(input: DeeplinkInput): string | null {
  const { app, origin, destination, waypoint, originName, destinationName, waypointName } = input;
  const from = originName || "출발지";
  const via = waypointName || "주유소";
  const to = destinationName || "목적지";

  switch (app) {
    case "KAKAO":
      return `https://map.kakao.com/link/by/car/${encodeURIComponent(from)},${origin.lat},${origin.lng}/${encodeURIComponent(via)},${waypoint.lat},${waypoint.lng}/${encodeURIComponent(to)},${destination.lat},${destination.lng}`;
    case "NAVER":
      return `https://map.naver.com/p/directions/${naverStopSegment(origin, from)}/${naverStopSegment(destination, to)}/${naverStopSegment(waypoint, via)}/car`;
    case "TMAP":
      return null;
  }
}
