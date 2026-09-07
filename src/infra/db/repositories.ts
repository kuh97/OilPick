/**
 * refuel_point · sigungu_avg_price 리포지토리.
 * ARCHITECTURE.md §7·§10 Phase 6.
 *
 * 순수 변환 함수(to___/from___ 접두사)와 DB 접근 함수를 분리합니다 — 전자는 DB 없이,
 * 후자는 주입된 db(기본값 getDb())로 테스트합니다 (opinet/budget.ts의
 * BudgetStore 주입 패턴과 동일).
 */

import { and, avg, count, desc, eq, gt, gte, inArray, isNull, lte, like, ne, sql } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { refuelPoint, refuelPointStaging, csvImportLog } from "./schema";
import { mapDetailItem, FUEL_TO_PRODCD } from "@/infra/opinet/mapper";
import type { OpinetDetailItem } from "@/infra/opinet/schema";
import { wgs84, katec } from "@/domain/types";
import type { RefuelPoint, EnergyType, Fuel } from "@/domain/types";

/** Fuel → refuel_point 가격 컬럼. bbox 조회·시군구/시도/전국 평균 조회가 공유합니다. */
function priceColumnFor(fuel: Fuel) {
  switch (fuel) {
    case "GASOLINE": return refuelPoint.priceGasoline;
    case "DIESEL": return refuelPoint.priceDiesel;
    case "LPG": return refuelPoint.priceLpg;
  }
}

function priceValueFor(row: RefuelPointRow, fuel: Fuel): number | null {
  switch (fuel) {
    case "GASOLINE": return row.priceGasoline;
    case "DIESEL": return row.priceDiesel;
    case "LPG": return row.priceLpg;
  }
}

// ─── refuel_point ───────────────────────────────────────────────────────────

export type RefuelPointInsert = typeof refuelPoint.$inferInsert;
export type RefuelPointRow = typeof refuelPoint.$inferSelect;

export interface UpsertRefuelPointOptions {
  /** 상세 조회를 촉발한 연료 — OIL_PRICE에서 가격 스냅샷을 골라내는 데 씀 */
  searchedFuel?: Fuel;
  now?: Date;
}

/** OpinetDetailItem → refuel_point insert row. 순수 함수 (DB 미접근). */
export function toRefuelPointInsert(
  item: OpinetDetailItem,
  opts: UpsertRefuelPointOptions = {},
): RefuelPointInsert {
  const mapped = mapDetailItem(item);
  const now = opts.now ?? new Date();

  let lastPrice: number | null = null;
  let lastPriceProd: string | null = null;
  if (opts.searchedFuel && item.OIL_PRICE) {
    const prodcd = FUEL_TO_PRODCD[opts.searchedFuel];
    const entry = item.OIL_PRICE.find((p) => p.PRODCD === prodcd);
    if (entry) {
      lastPrice = entry.PRICE;
      lastPriceProd = entry.PRODCD;
    }
  }

  return {
    id: mapped.id,
    name: mapped.name,
    brandCode: mapped.brandCode,
    energyType: mapped.energyType,
    lat: mapped.location.lat,
    lng: mapped.location.lng,
    katecX: mapped.katecLocation?.x ?? null,
    katecY: mapped.katecLocation?.y ?? null,
    addressRoad: mapped.addressRoad ?? null,
    addressJibun: mapped.addressJibun ?? null,
    tel: mapped.tel ?? null,
    sigunCd: mapped.sigunCd ?? null,
    hasCarWash: mapped.facilities.carWash,
    hasMaintenance: mapped.facilities.maintenance,
    hasCvs: mapped.facilities.cvs,
    isKpetro: mapped.isKpetro,
    lastPrice,
    lastPriceProd,
    priceTradedAt: null, // 오피넷 응답에 기준시각 없음 — ARCHITECTURE.md §5.1 실측 확정
    source: "OPINET",
    detailSyncedAt: now,
    updatedAt: now,
  };
}

/** refuel_point row → 도메인 RefuelPoint. 순수 함수 (DB 미접근). */
export function fromRefuelPointRow(row: RefuelPointRow): RefuelPoint {
  return {
    id: row.id,
    name: row.name,
    brandCode: row.brandCode,
    energyType: row.energyType as EnergyType,
    location: wgs84(row.lat, row.lng),
    katecLocation:
      row.katecX != null && row.katecY != null ? katec(row.katecX, row.katecY) : undefined,
    addressRoad: row.addressRoad ?? undefined,
    addressJibun: row.addressJibun ?? undefined,
    tel: row.tel ?? undefined,
    sigunCd: row.sigunCd ?? undefined,
    facilities: {
      carWash: row.hasCarWash,
      maintenance: row.hasMaintenance,
      cvs: row.hasCvs,
    },
    isKpetro: row.isKpetro,
    isSelf: row.isSelf ?? undefined,
  };
}

/**
 * 오피넷 상세 API 응답을 refuel_point에 upsert.
 * Fallback C — 마스터에 없는 UNI_ID를 반경검색에서 처음 만났을 때 호출합니다 (§7.1).
 * 가격 스냅샷은 새로 얻은 값이 있을 때만 덮어씁니다 — 매번 null로 지우지 않습니다.
 */
export async function upsertRefuelPointFromDetail(
  item: OpinetDetailItem,
  opts: UpsertRefuelPointOptions = {},
  db: Db = getDb(),
): Promise<void> {
  const row = toRefuelPointInsert(item, opts);
  await db
    .insert(refuelPoint)
    .values(row)
    .onConflictDoUpdate({
      target: refuelPoint.id,
      set: {
        name: row.name,
        brandCode: row.brandCode,
        energyType: row.energyType,
        lat: row.lat,
        lng: row.lng,
        katecX: row.katecX,
        katecY: row.katecY,
        addressRoad: row.addressRoad,
        addressJibun: row.addressJibun,
        tel: row.tel,
        sigunCd: row.sigunCd,
        hasCarWash: row.hasCarWash,
        hasMaintenance: row.hasMaintenance,
        hasCvs: row.hasCvs,
        isKpetro: row.isKpetro,
        ...(row.lastPrice != null
          ? { lastPrice: row.lastPrice, lastPriceProd: row.lastPriceProd }
          : {}),
        source: row.source,
        detailSyncedAt: row.detailSyncedAt,
        updatedAt: row.updatedAt,
      },
    });
}

/**
 * UNI_ID 목록으로 마스터를 조회 — 반경검색 결과를 이 결과와 조인하면
 * 시설 필터의 상세 조회 호출이 0으로 떨어집니다 (§10 Phase 6 완료 기준).
 */
export async function findRefuelPointsByIds(
  ids: string[],
  db: Db = getDb(),
): Promise<RefuelPoint[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(refuelPoint).where(inArray(refuelPoint.id, ids));
  return rows.map(fromRefuelPointRow);
}

/**
 * 단일 주유소를 가격 스냅샷(`lastPrice`)까지 포함한 원본 row로 조회.
 * `fromRefuelPointRow`는 가격을 domain `RefuelPoint`에 포함시키지 않으므로(가격은
 * 검색 시점 값이라 station 엔티티가 아닌 Candidate가 들고 있음 — §7.1), 경로 없이
 * 상세만 필요한 GET /api/stations/:id(§6.4)는 이 함수를 씁니다.
 * `lastPrice`는 마지막으로 검색됐던 연료(`lastPriceProd`) 기준이라, 요청한 연료와
 * 다를 수 있습니다 — PRODUCT.md §5.6이 이 기능에 시간을 많이 쓰지 말라고 명시한 만큼
 * 현재는 이 한계를 그대로 노출합니다.
 */
export async function findRefuelPointRowById(
  id: string,
  db: Db = getDb(),
): Promise<RefuelPointRow | undefined> {
  const [row] = await db.select().from(refuelPoint).where(eq(refuelPoint.id, id));
  return row;
}

// ─── refuel_point — 유가 CSV 임포트 (docs/MIGRATION-DB.md §6 컬럼 소유권 규칙) ──
//
// upsertRefuelPointFromDetail(상세 API 소유 컬럼)과 SET 절이 절대 겹치면 안 됩니다.
// has_car_wash·has_maintenance·has_cvs·is_kpetro·tel·detail_synced_at은 여기서
// 건드리지 않습니다 — 매일 CSV를 다시 임포트해도 상세 API로 백필한 시설정보가
// 지워지지 않는 이유입니다. lat/lng/coord_source는 기존 값이 없을 때만 채웁니다
// (오피넷 실좌표를 지오코딩 값으로 덮지 않기 위함 — 좌표는 호출부가 미리 조회해서
// 채워 넘기므로 여기 COALESCE는 이중 안전장치입니다).

export interface CsvUpsertRow {
  id: string;
  name: string;
  brandCode: string;
  energyType: EnergyType;
  lat: number;
  lng: number;
  coordSource: string; // 'OPINET' | 'KAKAO_ADDR' | 'KAKAO_KEYWORD'
  addressRoad: string;
  sigunCd: string | null;
  isSelf: boolean;
  pricedOn: string;    // "YYYY-MM-DD"
  lastSeenOn: string;  // "YYYY-MM-DD"
  priceGasoline: number | null;
  priceDiesel: number | null;
  priceLpg: number | null;
  pricePremium: number | null;
  priceKerosene: number | null;
}

/**
 * 유가 CSV 병합 결과를 refuel_point에 upsert.
 * scripts/import-price-csv.ts가 일 1회(또는 최초 1회 구축 시) 호출합니다.
 * 반환값은 upsert를 시도한 행 수입니다. 호출부가 청크 단위로 나눠 부릅니다
 * (Neon HTTP 드라이버 한 요청에 만 건 단위를 그대로 보내지 않기 위함).
 */
export async function bulkUpsertFromCsv(
  rows: CsvUpsertRow[],
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map((r) => ({
    id: r.id,
    name: r.name,
    brandCode: r.brandCode,
    energyType: r.energyType,
    lat: r.lat,
    lng: r.lng,
    coordSource: r.coordSource,
    addressRoad: r.addressRoad,
    sigunCd: r.sigunCd,
    isSelf: r.isSelf,
    pricedOn: r.pricedOn,
    lastSeenOn: r.lastSeenOn,
    priceGasoline: r.priceGasoline,
    priceDiesel: r.priceDiesel,
    priceLpg: r.priceLpg,
    pricePremium: r.pricePremium,
    priceKerosene: r.priceKerosene,
    source: "OPINET_CSV",
    updatedAt: now,
  }));

  await db
    .insert(refuelPoint)
    .values(values)
    .onConflictDoUpdate({
      target: refuelPoint.id,
      set: {
        name: sql`excluded.name`,
        brandCode: sql`excluded.brand_code`,
        energyType: sql`excluded.energy_type`,
        addressRoad: sql`excluded.address_road`,
        sigunCd: sql`excluded.sigun_cd`,
        isSelf: sql`excluded.is_self`,
        pricedOn: sql`excluded.priced_on`,
        lastSeenOn: sql`excluded.last_seen_on`,
        priceGasoline: sql`excluded.price_gasoline`,
        priceDiesel: sql`excluded.price_diesel`,
        priceLpg: sql`excluded.price_lpg`,
        pricePremium: sql`excluded.price_premium`,
        priceKerosene: sql`excluded.price_kerosene`,
        lat: sql`coalesce(${refuelPoint.lat}, excluded.lat)`,
        lng: sql`coalesce(${refuelPoint.lng}, excluded.lng)`,
        coordSource: sql`coalesce(${refuelPoint.coordSource}, excluded.coord_source)`,
        updatedAt: sql`excluded.updated_at`,
        // has_car_wash / has_maintenance / has_cvs / is_kpetro / tel /
        // detail_synced_at / source — 의도적으로 없음 (컬럼 소유권 규칙)
      },
    });

  return values.length;
}

// ─── refuel_point — 경로 검색 (docs/MIGRATION-DB.md §7 Phase C) ──────────────

export interface BboxRefuelPointResult {
  station: RefuelPoint;
  price: number;
  pricedOn: string | null; // "YYYY-MM-DD". 상세 API로만 채워진 행(CSV 미도달)은 null
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * bbox 안의 주유소를 실가격과 함께 조회 — 오피넷 반경검색을 대체합니다 (§7 Phase C).
 * `price_{fuel} > 0`(A3 — 미취급 제외)과 `last_seen_on >= now - 7일`(폐업 감지, CSV가
 * 며칠간 재발견하지 못한 곳은 제외)만 필터링합니다. 티어 분류·정밀 거리 계산은
 * 호출부(station-service → recommendation-service)의 몫입니다 — 여기서는 bbox
 * 사각형 안의 후보 전량만 돌려줍니다.
 */
export async function findRefuelPointsInBbox(
  bbox: Bbox,
  fuel: Fuel,
  now: Date,
  db: Db = getDb(),
): Promise<BboxRefuelPointResult[]> {
  const priceCol = priceColumnFor(fuel);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const rows = await db
    .select()
    .from(refuelPoint)
    .where(
      and(
        gte(refuelPoint.lat, bbox.minLat),
        lte(refuelPoint.lat, bbox.maxLat),
        gte(refuelPoint.lng, bbox.minLng),
        lte(refuelPoint.lng, bbox.maxLng),
        gt(priceCol, 0),
        gte(refuelPoint.lastSeenOn, cutoff),
      ),
    );

  return rows.map((row) => ({
    station: fromRefuelPointRow(row),
    price: priceValueFor(row, fuel)!,
    pricedOn: row.pricedOn,
  }));
}

// ─── P_ref 시군구/시도/전국 평균 — refuel_point 실시간 집계 (§7 Phase C) ──────
//
// 예전엔 오피넷 avgSigunPrice.do를 일 1회 배치로 긁어 sigungu_avg_price에 저장해뒀다가
// 조회했지만, 이제 refuel_point 자체가 전국 실가격 마스터라 그때그때 집계하면 된다
// (배치·오피넷 호출 불필요 — MIGRATION-DB.md §2 "일 배치 오피넷 호출 0회").
// price-service.ts는 이 세 함수를 이름·시그니처 그대로 호출하므로 변경이 없다.

/** P_ref 시군구 평균 폴백 조회 (price-service가 §8에서 사용) */
export async function findSigunguAvgPrice(
  sigunCd: string,
  fuel: Fuel,
  db: Db = getDb(),
): Promise<number | null> {
  const priceCol = priceColumnFor(fuel);
  const [row] = await db
    .select({ avgPrice: avg(priceCol) })
    .from(refuelPoint)
    .where(and(eq(refuelPoint.sigunCd, sigunCd), gt(priceCol, 0)));
  return row?.avgPrice != null ? Math.round(Number(row.avgPrice)) : null;
}

/**
 * P_ref 시도 평균 폴백 조회 — 시군구 평균가가 없을 때의 다음 단계 (PRODUCT.md §8).
 * `sigun_cd`의 앞 2자리(시도코드)가 일치하는 행들을 평균 냅니다.
 */
export async function findSidoAvgPrice(
  sidoPrefix2: string,
  fuel: Fuel,
  db: Db = getDb(),
): Promise<number | null> {
  const priceCol = priceColumnFor(fuel);
  const [row] = await db
    .select({ avgPrice: avg(priceCol) })
    .from(refuelPoint)
    .where(and(like(refuelPoint.sigunCd, `${sidoPrefix2}%`), gt(priceCol, 0)));
  return row?.avgPrice != null ? Math.round(Number(row.avgPrice)) : null;
}

/**
 * P_ref 전국 평균 폴백 조회 — 시군구·시도 평균가가 모두 없을 때의 마지막 단계 (PRODUCT.md §8).
 */
export async function findNationalAvgPrice(fuel: Fuel, db: Db = getDb()): Promise<number | null> {
  const priceCol = priceColumnFor(fuel);
  const [row] = await db
    .select({ avgPrice: avg(priceCol) })
    .from(refuelPoint)
    .where(gt(priceCol, 0));
  return row?.avgPrice != null ? Math.round(Number(row.avgPrice)) : null;
}

// ─── 일일 CSV 임포트 — 스테이징·스왑·이력 (docs/MIGRATION-DB.md §7 Phase D) ─────

const STAGING_CHUNK = 500; // Neon HTTP 한 요청에 만 건을 그대로 보내지 않음

export type StagingRow = typeof refuelPointStaging.$inferInsert;

export interface CsvImportLogEntry {
  pricedOn: string | null;
  status: "OK" | "GATE_FAILED" | "DOWNLOAD_FAILED";
  failedGate?: string | null;
  detail?: string | null;
  oilRows?: number | null;
  lpgRows?: number | null;
  geocoded?: number | null;
}

/** 직전 '성공' 임포트의 기준일자·행 수 — G3·G4가 참조. 없으면 null(최초 임포트). */
export async function getLastSuccessfulImport(
  db: Db = getDb(),
): Promise<{ pricedOn: string; oilRows: number; lpgRows: number } | null> {
  const [row] = await db
    .select({
      pricedOn: csvImportLog.pricedOn,
      oilRows: csvImportLog.oilRows,
      lpgRows: csvImportLog.lpgRows,
    })
    .from(csvImportLog)
    .where(eq(csvImportLog.status, "OK"))
    .orderBy(desc(csvImportLog.id))
    .limit(1);
  if (!row || row.pricedOn == null) return null;
  return { pricedOn: row.pricedOn, oilRows: row.oilRows ?? 0, lpgRows: row.lpgRows ?? 0 };
}

/** 가장 최근 임포트 이력 1건 (상태 무관) — 결과 화면 "가격 기준일자" 배너용. */
export async function getLatestImportLog(
  db: Db = getDb(),
): Promise<{ pricedOn: string | null; status: string; startedAt: Date } | undefined> {
  const [row] = await db
    .select({
      pricedOn: csvImportLog.pricedOn,
      status: csvImportLog.status,
      startedAt: csvImportLog.startedAt,
    })
    .from(csvImportLog)
    .orderBy(desc(csvImportLog.id))
    .limit(1);
  return row;
}

/** refuel_point 전체의 좌표 상태 — G6(ID 교집합)과 "좌표 없는 행만 지오코딩" 판정에 쓴다. */
export async function getExistingStationCoords(
  db: Db = getDb(),
): Promise<Map<string, { lat: number | null; lng: number | null; coordSource: string | null }>> {
  const rows = await db
    .select({
      id: refuelPoint.id,
      lat: refuelPoint.lat,
      lng: refuelPoint.lng,
      coordSource: refuelPoint.coordSource,
    })
    .from(refuelPoint);
  return new Map(rows.map((r) => [r.id, { lat: r.lat, lng: r.lng, coordSource: r.coordSource }]));
}

export async function writeCsvImportLog(
  entry: CsvImportLogEntry,
  db: Db = getDb(),
): Promise<void> {
  await db.insert(csvImportLog).values({
    pricedOn: entry.pricedOn,
    status: entry.status,
    failedGate: entry.failedGate ?? null,
    detail: entry.detail ?? null,
    oilRows: entry.oilRows ?? null,
    lpgRows: entry.lpgRows ?? null,
    geocoded: entry.geocoded ?? null,
  });
}

/** 스테이징 비우기 — 매 임포트 시작 시 호출. */
export async function resetStaging(db: Db = getDb()): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE ${refuelPointStaging}`);
}

/** 검증을 통과한 행들을 스테이징에 적재 (청크 단위). refuel_point는 아직 건드리지 않는다. */
export async function loadStaging(rows: StagingRow[], db: Db = getDb()): Promise<number> {
  for (let i = 0; i < rows.length; i += STAGING_CHUNK) {
    await db.insert(refuelPointStaging).values(rows.slice(i, i + STAGING_CHUNK));
  }
  return rows.length;
}

/**
 * 스테이징 → refuel_point 원자적 반영. 단일 `INSERT ... SELECT ... ON CONFLICT`이라
 * Neon HTTP 드라이버에서도 문장 하나가 곧 트랜잭션 — 중간 실패 시 refuel_point 무변경.
 *
 * SET 절은 bulkUpsertFromCsv와 **정확히 같은 컬럼 소유권 규칙**을 따른다(§6):
 * 시설정보·is_kpetro·tel·detail_synced_at·source는 건드리지 않고, 좌표는 비어 있을
 * 때만 채운다. 좌표가 없는 스테이징 행(신규 지오코딩 실패분)은 반영에서 제외한다.
 */
export async function swapStagingToRefuelPoint(db: Db = getDb()): Promise<void> {
  await db.execute(sql`
    INSERT INTO refuel_point (
      id, name, brand_code, energy_type, lat, lng, coord_source,
      address_road, sigun_cd, is_self, priced_on, last_seen_on,
      price_gasoline, price_diesel, price_lpg, price_premium, price_kerosene,
      source, updated_at
    )
    SELECT
      s.id, s.name, s.brand_code, s.energy_type, s.lat, s.lng, s.coord_source,
      s.address_road, s.sigun_cd, s.is_self, s.priced_on, s.last_seen_on,
      s.price_gasoline, s.price_diesel, s.price_lpg, s.price_premium, s.price_kerosene,
      'OPINET_CSV', now()
    FROM refuel_point_staging s
    WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      brand_code = excluded.brand_code,
      energy_type = excluded.energy_type,
      address_road = excluded.address_road,
      sigun_cd = excluded.sigun_cd,
      is_self = excluded.is_self,
      priced_on = excluded.priced_on,
      last_seen_on = excluded.last_seen_on,
      price_gasoline = excluded.price_gasoline,
      price_diesel = excluded.price_diesel,
      price_lpg = excluded.price_lpg,
      price_premium = excluded.price_premium,
      price_kerosene = excluded.price_kerosene,
      lat = coalesce(refuel_point.lat, excluded.lat),
      lng = coalesce(refuel_point.lng, excluded.lng),
      coord_source = coalesce(refuel_point.coord_source, excluded.coord_source),
      updated_at = excluded.updated_at
  `);
}

// ─── 시설정보 백필 — 상세 API (docs/MIGRATION-DB.md §7 Phase E) ────────────────
//
// 검색 경로가 오피넷을 더 이상 쓰지 않으므로(§7 Phase C) 일일 예산 전부를 여기 씁니다.
// upsertRefuelPointFromDetail(폴백 C — 신규 주유소 INSERT)과 달리, 여기서는 이미
// CSV로 존재하는 행을 UPDATE하며 **상세 API가 소유한 컬럼만** 건드립니다(§6):
// has_car_wash·has_maintenance·has_cvs·is_kpetro·tel·detail_synced_at.
// name·brand_code·address·sigun_cd·energy_type·좌표·가격은 CSV 소유이므로 제외합니다.

/** 상세 API로 채울 시설정보 — mapDetailItem 결과에서 상세 API 소유 컬럼만 추린 것. */
export interface DetailBackfillFields {
  id: string; // 큐에서 꺼낸 UNI_ID를 정본으로 씀 (응답 UNI_ID가 달라도 이 행을 갱신)
  hasCarWash: boolean;
  hasMaintenance: boolean;
  hasCvs: boolean;
  isKpetro: boolean;
  tel: string | null;
}

/**
 * 시설정보가 아직 없는 주유소 UNI_ID 목록 (LPG 전용 충전소 제외 — 세차·정비가 무의미).
 *
 * 정렬: 최근까지 CSV에 등장한 곳(= 현재 영업 중, 검색에 잡힐 가능성 높음)을 먼저.
 * 큐 조건이 `detail_synced_at IS NULL`이므로 대상이 없으면 자동으로 멈춥니다(§7 Phase E).
 *
 * TODO(§7 Phase E 큐 우선순위): "검색 결과에 노출된 이력"·"고속도로 인접"을 앞세우려면
 * 각각 노출 타임스탬프 컬럼과 도로 지오메트리가 필요합니다 — 후속 작업으로 남겨둡니다.
 */
export async function findStationsNeedingDetailBackfill(
  limit: number,
  db: Db = getDb(),
): Promise<string[]> {
  const rows = await db
    .select({ id: refuelPoint.id })
    .from(refuelPoint)
    .where(and(isNull(refuelPoint.detailSyncedAt), ne(refuelPoint.energyType, "LPG")))
    .orderBy(desc(refuelPoint.lastSeenOn), refuelPoint.id)
    .limit(limit);
  return rows.map((r) => r.id);
}

/** 백필이 아직 필요한 총 건수 — 크론 응답의 `remaining`(진행률 추정용). */
export async function countStationsNeedingDetailBackfill(db: Db = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(refuelPoint)
    .where(and(isNull(refuelPoint.detailSyncedAt), ne(refuelPoint.energyType, "LPG")));
  return Number(row?.n ?? 0);
}

/**
 * 백필 진행 현황 — `pnpm data:backfill-details --status`가 읽는다 (오피넷 호출 없음).
 * 대상은 주유소(energy_type <> 'LPG')만. `done + remaining = total`.
 */
export async function getDetailBackfillProgress(
  db: Db = getDb(),
): Promise<{ done: number; remaining: number; total: number }> {
  const [row] = await db
    .select({
      done: count(refuelPoint.detailSyncedAt),
      total: count(),
    })
    .from(refuelPoint)
    .where(ne(refuelPoint.energyType, "LPG"));
  const done = Number(row?.done ?? 0);
  const total = Number(row?.total ?? 0);
  return { done, remaining: total - done, total };
}

/**
 * 상세 API로 얻은 시설정보 한 행을 refuel_point에 반영.
 * SET 절은 상세 API 소유 6개 컬럼 + updated_at 뿐입니다 — CSV 소유 컬럼은 절대 넣지
 * 않습니다(§6 컬럼 소유권 규칙). 대상 행은 이미 존재하므로 UPDATE입니다.
 */
export async function updateDetailFields(
  fields: DetailBackfillFields,
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(refuelPoint)
    .set({
      hasCarWash: fields.hasCarWash,
      hasMaintenance: fields.hasMaintenance,
      hasCvs: fields.hasCvs,
      isKpetro: fields.isKpetro,
      tel: fields.tel,
      detailSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(refuelPoint.id, fields.id));
}

/**
 * 상세 API에 존재하지 않는(폐업 추정) UNI_ID를 "확인함"으로만 표시합니다.
 * detail_synced_at만 채우므로 시설 플래그는 기본값(false)으로 남고, 매일 재시도되어
 * 예산을 갉아먹는 일이 없어집니다. 폐업 주유소는 last_seen_on 컷오프로 검색에서
 * 이미 빠지므로(§7 Phase C) 표시만으로 충분합니다.
 */
export async function markDetailSyncedEmpty(
  ids: string[],
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<number> {
  if (ids.length === 0) return 0;
  await db
    .update(refuelPoint)
    .set({ detailSyncedAt: now, updatedAt: now })
    .where(inArray(refuelPoint.id, ids));
  return ids.length;
}
