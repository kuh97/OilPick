/**
 * 내 주변 (F10) — ARCHITECTURE.md §6.4·§10 Phase 8, PRODUCT.md §5.6.
 * 경로가 없으므로 tier·detour·netSaving·scores·reason은 계산하지 않습니다.
 * station-service는 bbox(사각형)로 조회하므로, SEARCH_RADIUS(5km) 원형 반경 밖으로
 * 삐져나온 모서리 결과는 여기서 거리로 다시 걸러냅니다.
 */

import { NextResponse } from "next/server";
import { collectStations } from "@/services/station-service";
import { wgs84 } from "@/domain/types";
import { wgs84ToProjected, distanceM as projectedDistanceM } from "@/domain/geo";
import { SEARCH_RADIUS } from "@/domain/params";
import { NearbyQuerySchema } from "@/app/api/_lib/schema";
import { parseSearchParams } from "@/app/api/_lib/validate";
import type { WireNearbyStation } from "@/app/api/_lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseSearchParams(url, NearbyQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { lat, lng, fuel, sort } = parsed.data;

  const origin = wgs84(lat, lng);
  const originProjected = wgs84ToProjected(origin);
  const now = new Date();

  const { stations } = await collectStations({
    referencePoints: [originProjected],
    marginM: SEARCH_RADIUS,
    fuel,
    filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    now,
  });

  const items: WireNearbyStation[] = stations
    .map(({ station, price, pricedOn }) => ({
      id: station.id,
      name: station.name,
      brand: station.brandCode,
      lat: station.location.lat,
      lng: station.location.lng,
      address: station.addressRoad || station.addressJibun || "",
      tel: station.tel ?? null,
      price,
      priceUpdatedAt: pricedOn ? `${pricedOn}T00:00:00.000Z` : null,
      facilities: { ...station.facilities },
      kpetro: station.isKpetro,
      distanceM: Math.round(projectedDistanceM(originProjected, wgs84ToProjected(station.location))),
    }))
    .filter((item) => item.distanceM <= SEARCH_RADIUS);

  items.sort((a, b) => (sort === "distance" ? a.distanceM - b.distanceM : a.price - b.price));

  return NextResponse.json({ stations: items });
}
