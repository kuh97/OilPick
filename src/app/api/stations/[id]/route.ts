/**
 * 상세 보강 — ARCHITECTURE.md §6.4·§10 Phase 8.
 * `Candidate`에서 경로 의존 필드(tier·perpDistanceM·detour·netSaving·scores·reason)를
 * 뺀 형태. 경로 컨텍스트가 없으므로 가격은 DB의 최근 스냅샷을 씁니다 — 검색
 * 시점처럼 오피넷을 새로 부르지 않습니다.
 *
 * 요청 연료의 유가 CSV 스냅샷을 우선 사용하고, CSV 가격이 없을 때만 같은 연료로
 * 저장된 상세 API 스냅샷(`lastPrice`·`lastPriceProd`)을 폴백으로 사용합니다.
 * 다른 연료의 `lastPrice`를 반환하면 주변 지도/카드와 가격이 달라질 수 있습니다.
 * docs/MIGRATION-DB.md §5.1 — CSV로만 들어온 ~10,900개소는 lastPrice가 항상 null이라
 * 이 폴백이 없으면 가격이 늘 비어 있었다.
 */

import { NextResponse } from "next/server";
import { findRefuelPointRowById, fromRefuelPointRow } from "@/infra/db/repositories";
import { FUEL_TO_PRODCD } from "@/infra/opinet/mapper";
import type { Fuel } from "@/domain/types";
import { StationDetailQuerySchema } from "@/app/api/_lib/schema";
import { parseSearchParams } from "@/app/api/_lib/validate";
import type { WireStationSummary } from "@/app/api/_lib/types";
import type { RefuelPointRow } from "@/infra/db/repositories";

function csvPriceFor(row: RefuelPointRow, fuel: Fuel): number | null {
  switch (fuel) {
    case "GASOLINE": return row.priceGasoline;
    case "DIESEL": return row.priceDiesel;
    case "LPG": return row.priceLpg;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = parseSearchParams(new URL(request.url), StationDetailQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { fuel } = parsed.data;
  const { id } = await params;
  const row = await findRefuelPointRowById(id);
  if (!row) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "주유소를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const station = fromRefuelPointRow(row);

  const csvPrice = csvPriceFor(row, fuel);
  let price = csvPrice;
  let priceUpdatedAt = csvPrice != null && row.pricedOn
    ? `${row.pricedOn}T00:00:00.000Z`
    : null;
  if (price == null && row.lastPrice != null && row.lastPriceProd === FUEL_TO_PRODCD[fuel]) {
    price = row.lastPrice;
    priceUpdatedAt = row.priceTradedAt ? row.priceTradedAt.toISOString() : null;
  }

  const summary: WireStationSummary = {
    id: station.id,
    name: station.name,
    brand: station.brandCode,
    lat: station.location.lat,
    lng: station.location.lng,
    address: station.addressRoad || station.addressJibun || "",
    tel: station.tel ?? null,
    price,
    priceUpdatedAt,
    facilities: { ...station.facilities },
    kpetro: station.isKpetro,
  };

  return NextResponse.json(summary);
}
