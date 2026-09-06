/**
 * Drizzle 스키마 — ARCHITECTURE.md §7.
 *
 * 테이블·컬럼 이름을 gas_station/oil_type처럼 좁게 만들지 않습니다.
 * refuel_point/energy_type을 유지합니다 (§9 변경 원칙, 향후 전기차 충전소 확장 대비).
 */

import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  integer,
  serial,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ─── refuel_point — 주유소 마스터 (§7.1, docs/MIGRATION-DB.md §5.1) ────────────
//
// 폴백 C 채택 — 표준데이터(행안부)는 UNI_ID·시설 컬럼이 없어 임포트하지 않습니다.
// 마스터는 오피넷 유가 CSV(source='OPINET_CSV')로 채우고, 시설 정보만 상세 API로
// 백그라운드 백필합니다(source='OPINET' — Fallback C, 상세 API 신규 발견분).

export const refuelPoint = pgTable(
  "refuel_point",
  {
    id: text("id").primaryKey(),                 // 오피넷 UNI_ID
    name: text("name").notNull(),
    brandCode: text("brand_code").notNull(),      // POLL_DIV_CD/CO
    energyType: text("energy_type").notNull(),    // 'OIL' | 'LPG' | 'BOTH'
    lat: doublePrecision("lat").notNull(),         // WGS84
    lng: doublePrecision("lng").notNull(),         // WGS84
    katecX: doublePrecision("katec_x"),
    katecY: doublePrecision("katec_y"),
    addressRoad: text("address_road"),
    addressJibun: text("address_jibun"),
    tel: text("tel"),
    sigunCd: text("sigun_cd"),                     // 시군구 평균가 조인 키
    isSelf: boolean("is_self"),                    // CSV 셀프여부. NULL=미상(상세 API로만 채워진 행)
    coordSource: text("coord_source"),             // 'OPINET' | 'KAKAO_ADDR' | 'KAKAO_KEYWORD'

    hasCarWash: boolean("has_car_wash").notNull().default(false),
    hasMaintenance: boolean("has_maintenance").notNull().default(false),
    hasCvs: boolean("has_cvs").notNull().default(false),
    isKpetro: boolean("is_kpetro").notNull().default(false),

    // 가격 스냅샷: 기준시각 표시(§5.1)와 폐업 휴리스틱용
    lastPrice: integer("last_price"),
    lastPriceProd: text("last_price_prod"),        // B027 | D047 | K015
    priceTradedAt: timestamp("price_traded_at", { withTimezone: true }),

    // CSV 유종별 스냅샷 — 최신 1일치만 덮어씀(이력 테이블 없음, MIGRATION-DB §11 결정 ③)
    priceGasoline: integer("price_gasoline"),      // B027
    priceDiesel: integer("price_diesel"),          // D047
    priceLpg: integer("price_lpg"),                // K015
    pricePremium: integer("price_premium"),        // B034 — 적재만, UI 미노출
    priceKerosene: integer("price_kerosene"),      // C004 — 적재만, UI 미노출
    pricedOn: date("priced_on"),                   // CSV 기준일자
    lastSeenOn: date("last_seen_on"),               // 마지막으로 CSV에 등장한 날 (폐업 감지용)

    source: text("source").notNull(),              // 'STANDARD_DATA' | 'OPINET' | 'OPINET_CSV'
    detailSyncedAt: timestamp("detail_synced_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_refuel_point_sigun").on(table.sigunCd),
    index("idx_refuel_point_energy").on(table.energyType),
    index("idx_refuel_point_latlng").on(table.lat, table.lng),
    index("idx_refuel_point_seen").on(table.lastSeenOn),
  ],
);

// ─── refuel_point_staging — 일일 CSV 임포트 스테이징 (docs/MIGRATION-DB.md §7 Phase D) ──
//
// 검증 게이트 8개를 모두 통과한 뒤에만 이 테이블을 채우고, refuel_point로의 반영은
// 단일 `INSERT ... SELECT ... ON CONFLICT` 한 문장으로 원자적으로 수행합니다
// (Neon HTTP 드라이버는 문장 하나가 곧 트랜잭션). 실패하면 refuel_point는 그대로,
// 어제 데이터로 계속 서비스됩니다. CSV 소유 컬럼만 담습니다 — 시설정보(detail API
// 소유)는 여기 없으므로 스왑이 그것을 건드릴 수 없습니다(§6 컬럼 소유권 규칙).

export const refuelPointStaging = pgTable("refuel_point_staging", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brandCode: text("brand_code").notNull(),
  energyType: text("energy_type").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  coordSource: text("coord_source"),
  addressRoad: text("address_road"),
  sigunCd: text("sigun_cd"),
  isSelf: boolean("is_self"),
  pricedOn: date("priced_on"),
  lastSeenOn: date("last_seen_on"),
  priceGasoline: integer("price_gasoline"),
  priceDiesel: integer("price_diesel"),
  priceLpg: integer("price_lpg"),
  pricePremium: integer("price_premium"),
  priceKerosene: integer("price_kerosene"),
});

// ─── csv_import_log — 임포트 이력 (docs/MIGRATION-DB.md §5.2·§8) ────────────────
//
// G3(기준일자 신규성)·G4(행 수 ±10%)가 직전 성공분을 참조하고, 결과 화면 배너가
// "가격 정보가 YYYY-MM-DD 기준입니다"를 여기서 읽습니다.

export const csvImportLog = pgTable("csv_import_log", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  pricedOn: date("priced_on"),                    // 파일에서 파싱한 기준일자
  status: text("status").notNull(),               // 'OK' | 'GATE_FAILED' | 'DOWNLOAD_FAILED'
  failedGate: text("failed_gate"),                // 'G4' 등
  detail: text("detail"),
  oilRows: integer("oil_rows"),
  lpgRows: integer("lpg_rows"),
  geocoded: integer("geocoded"),
});
