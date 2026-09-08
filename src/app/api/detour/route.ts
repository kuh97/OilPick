/**
 * 카드 탭 시 lazy 정밀 계산 — ARCHITECTURE.md §6.3·§10 Phase 8.
 * 기본 경로는 route-service 캐시(1시간 TTL)를 그대로 타므로 실질적으로 카카오
 * 경로 API는 경유 경로 1회만 나갑니다.
 */

import { NextResponse } from "next/server";
import { getRoute } from "@/services/route-service";
import { findRefuelPointsByIds } from "@/infra/db/repositories";
import { netSaving } from "@/domain/pricing";
import { wgs84 } from "@/domain/types";
import { DetourRequestSchema } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { serializeBaseRoute } from "@/app/api/_lib/serialize";

export const maxDuration = 10;

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, DetourRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const [station] = await findRefuelPointsByIds([body.stationId]);
  if (!station) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "주유소를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const origin = wgs84(body.origin.lat, body.origin.lng);
  const destination = wgs84(body.destination.lat, body.destination.lng);

  try {
    const [baseRoute, viaRoute] = await Promise.all([
      getRoute({ origin, destination, avoidHighway: body.avoidHighway }),
      getRoute({ origin, destination, waypoint: station.location, avoidHighway: body.avoidHighway, retries: 0 }),
    ]);

    const distanceM = Math.max(0, viaRoute.distanceM - baseRoute.distanceM);
    const durationS = Math.max(0, viaRoute.durationS - baseRoute.durationS);
    // 정보 표시 전용 (netSaving 미반영) — domain/types.ts DetourInfo.tollWon 참고.
    const tollWon =
      viaRoute.tollWon != null && baseRoute.tollWon != null
        ? Math.max(0, viaRoute.tollWon - baseRoute.tollWon)
        : undefined;

    const saving = netSaving({
      priceRefWon: body.referencePrice,
      priceStationWon: body.priceStation,
      refuelAmountL: body.vehicle.refuelAmount,
      detourDistanceM: distanceM,
      efficiencyKmPerL: body.vehicle.efficiency,
    });

    // 지도에 "경유 경로(강조)"를 그리려면 폴리라인이 필요하다 — 이미 계산해둔
    // viaRoute에서 그대로 뽑아 쓴다(§5.4). 기본 경로 폴리라인은 이미 검색 결과에
    // 있으므로 여기서 중복으로 보내지 않는다.
    return NextResponse.json({
      distanceM,
      durationS,
      precise: true,
      netSaving: saving,
      tollWon,
      polyline: serializeBaseRoute(viaRoute).polyline,
    });
  } catch {
    return NextResponse.json(
      { code: "ROUTE_FETCH_FAILED", message: "경유 경로를 계산하지 못했습니다." },
      { status: 502 },
    );
  }
}
