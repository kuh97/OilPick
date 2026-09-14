/**
 * F10 주변 상세 지도 — 현재 위치에서 선택한 주유소까지의 실제 도로 경로.
 * 추천 경로·우회 계산과 무관한 정보 표시용 요청이며, 공용 route-service의
 * 캐시와 카카오모빌리티 어댑터를 재사용합니다.
 */

import { NextResponse } from "next/server";
import { StationRouteRequestSchema } from "@/app/api/_lib/schema";
import { serializeBaseRoute } from "@/app/api/_lib/serialize";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { findRefuelPointsByIds } from "@/infra/db/repositories";
import { wgs84 } from "@/domain/types";
import { getRoute } from "@/services/route-service";

export const maxDuration = 10;

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, StationRouteRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const [station] = await findRefuelPointsByIds([body.stationId]);
  if (!station) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "주유소를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  try {
    const route = await getRoute({
      origin: wgs84(body.origin.lat, body.origin.lng),
      destination: station.location,
    });
    return NextResponse.json(serializeBaseRoute(route));
  } catch {
    return NextResponse.json(
      { code: "ROUTE_FETCH_FAILED", message: "주유소까지의 경로를 계산하지 못했습니다." },
      { status: 502 },
    );
  }
}
