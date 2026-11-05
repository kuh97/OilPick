/**
 * Valhalla 응답을 도메인 BaseRoute로 변환합니다.
 * Valhalla summary.length는 km, summary.time은 초이므로 도메인 계약(m·s)에
 * 맞춰 이 파일에서만 km→m 변환을 수행합니다.
 */

import { wgs84 } from "@/domain/types";
import type { BaseRoute, WGS84Point } from "@/domain/types";
import type { ValhallaResponse } from "./schema";

function decodePolyline6(encoded: string): WGS84Point[] {
  const points: WGS84Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const latResult = decodeValue(encoded, index);
    index = latResult.nextIndex;
    const lngResult = decodeValue(encoded, index);
    index = lngResult.nextIndex;
    lat += (latResult.value & 1) === 1 ? ~(latResult.value >> 1) : latResult.value >> 1;
    lng += (lngResult.value & 1) === 1 ? ~(lngResult.value >> 1) : lngResult.value >> 1;
    points.push(wgs84(lat / 1_000_000, lng / 1_000_000));
  }

  return points;
}

function decodeValue(
  encoded: string,
  startIndex: number,
): { value: number; nextIndex: number } {
  let result = 0;
  let shift = 0;
  let index = startIndex;

  while (index < encoded.length) {
    const code = encoded.charCodeAt(index++) - 63;
    if (code < 0 || code > 63) throw new Error("Valhalla 폴리라인 디코딩 실패");
    result |= (code & 0x1f) << shift;
    shift += 5;
    if (code < 0x20) return { value: result, nextIndex: index };
  }

  throw new Error("Valhalla 폴리라인이 중간에 끝났습니다.");
}

function joinLegShapes(response: ValhallaResponse): WGS84Point[] {
  return response.trip.legs.reduce<WGS84Point[]>((points, leg) => {
    const legPoints = decodePolyline6(leg.shape);
    if (points.length > 0 && legPoints.length > 0) legPoints.shift();
    return points.concat(legPoints);
  }, []);
}

export function mapValhallaResponse(response: ValhallaResponse): BaseRoute {
  if (response.trip.status !== 0) {
    throw new Error(
      `Valhalla 경로 탐색 실패 (status=${response.trip.status}): ${response.trip.status_message ?? "경로 없음"}`,
    );
  }

  const polyline = joinLegShapes(response);
  if (polyline.length === 0) {
    throw new Error("Valhalla 경로 응답에 폴리라인이 없습니다.");
  }

  return {
    distanceM: Math.round(response.trip.summary.length * 1000),
    durationS: Math.round(response.trip.summary.time),
    polyline,
  };
}

export { decodePolyline6 };
