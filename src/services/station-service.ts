/**
 * bbox 내 주유소 수집 — 오피넷 반경검색 대체.
 * docs/MIGRATION-DB.md §7 Phase C — 경로 폴리라인(또는 내 주변 단일 지점) 주변의
 * bbox로 refuel_point를 한 번에 조회합니다. 오피넷 호출·Redis 캐시·일일 예산은
 * 더 이상 필요하지 않습니다 (마스터가 이미 전국 실가격을 들고 있음).
 */

import { findRefuelPointsInBbox } from "@/infra/db/repositories";
import { projectedToWgs84 } from "@/domain/geo";
import { projected } from "@/domain/types";
import type { RefuelPoint, Fuel, Facility, BrandCode, ProjectedPoint } from "@/domain/types";
import type { Db } from "@/infra/db/client";

export interface CollectStationsFilters {
  facilities: Facility[];
  brands: BrandCode[];
  kpetroOnly: boolean;
  selfOnly: boolean;
}

export interface CollectedStation {
  station: RefuelPoint;
  price: number;
  /** CSV 기준일자("YYYY-MM-DD"). 상세 API로만 채워진 행(CSV 미도달)은 null */
  pricedOn: string | null;
}

export interface CollectStationsResult {
  stations: CollectedStation[];
}

export interface CollectStationsOptions {
  /** 후보를 찾을 기준 지점들(EPSG:5179) — 경로 폴리라인 전체 또는 단일 지점(내 주변) */
  referencePoints: ProjectedPoint[];
  /** bbox를 넓힐 여유(m). 경로 검색은 T3_MAX, 내 주변은 SEARCH_RADIUS */
  marginM: number;
  fuel: Fuel;
  filters: CollectStationsFilters;
  now?: Date;
  db?: Db;
  findRefuelPointsInBbox?: typeof findRefuelPointsInBbox;
}

function matchesFilters(station: RefuelPoint, filters: CollectStationsFilters): boolean {
  if (filters.kpetroOnly && !station.isKpetro) return false;
  // 셀프여부 미상(undefined)은 "셀프만" 필터에서 제외한다 — 가서 아니면 낭패이므로.
  if (filters.selfOnly && station.isSelf !== true) return false;
  if (filters.brands.length > 0 && !filters.brands.includes(station.brandCode)) return false;
  for (const facility of filters.facilities) {
    if (facility === "CAR_WASH" && !station.facilities.carWash) return false;
    if (facility === "MAINTENANCE" && !station.facilities.maintenance) return false;
    if (facility === "CVS" && !station.facilities.cvs) return false;
  }
  return true;
}

/**
 * 기준 지점들의 투영좌표 bbox를 marginM만큼 넓힌 뒤 WGS84 lat/lng 범위로 변환합니다.
 * 정사각형(bbox) 네 꼭짓점을 각각 역투영해 min/max를 잡으므로, 실제 원형/회랑
 * 반경보다 약간 넓게 잡힙니다 — 후보를 놓치는 대신 더 주는 쪽으로 안전하게 설계된
 * 것이고, 초과분은 호출부(회랑 d_perp 필터 또는 원형 거리 필터)가 걸러냅니다.
 */
function computeBbox(points: ProjectedPoint[], marginM: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const corners = [
    projected(minX - marginM, minY - marginM),
    projected(minX - marginM, maxY + marginM),
    projected(maxX + marginM, minY - marginM),
    projected(maxX + marginM, maxY + marginM),
  ].map(projectedToWgs84);

  return {
    minLat: Math.min(...corners.map((c) => c.lat)),
    maxLat: Math.max(...corners.map((c) => c.lat)),
    minLng: Math.min(...corners.map((c) => c.lng)),
    maxLng: Math.max(...corners.map((c) => c.lng)),
  };
}

/**
 * bbox 안의 후보를 조회하고 필터를 적용합니다.
 * 티어 분류·정밀 거리 계산·A3(가격 0 제외, DB 쿼리 자체에서 이미 처리)는 호출부의 몫입니다.
 */
export async function collectStations(opts: CollectStationsOptions): Promise<CollectStationsResult> {
  const now = opts.now ?? new Date();
  const findInBbox = opts.findRefuelPointsInBbox ?? findRefuelPointsInBbox;
  const bbox = computeBbox(opts.referencePoints, opts.marginM);
  const rows = await findInBbox(bbox, opts.fuel, now, opts.db);

  const stations: CollectedStation[] = [];
  for (const row of rows) {
    if (!matchesFilters(row.station, opts.filters)) continue;
    stations.push({ station: row.station, price: row.price, pricedOn: row.pricedOn });
  }

  return { stations };
}
