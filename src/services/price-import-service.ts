/**
 * 일일 유가 CSV 임포트 오케스트레이터 — docs/MIGRATION-DB.md §7 Phase D.
 *
 *   decode → parse(G1·G2) → sigun 매핑 → merge → 게이트 G3~G8
 *     → 신규/좌표결손 행만 지오코딩 → 스테이징 적재 → 원자적 스왑 → csv_import_log
 *
 * 어느 단계에서 멈추든 refuel_point는 검증을 전부 통과하기 전까지 건드리지 않습니다.
 * 실패는 예외가 아니라 결과값으로 돌려주고 csv_import_log에 남깁니다 —
 * "어제 데이터로 계속 서비스"가 정상 동작이기 때문입니다(§8).
 *
 * 이 함수는 Vercel Cron 라우트와 `pnpm data:import-csv` 스크립트가 **공유**합니다.
 * 로직을 복제하지 마십시오(ARCHITECTURE.md §9.3).
 */

import { decodeEucKr, parseOilCsv, parseLpgCsv, mergeCsvRows } from "@/infra/csv/parse";
import { runGates, type GateContext } from "@/infra/csv/gates";
import { getSigunMap } from "@/infra/opinet/sigun-map";
import { createSemaphore } from "@/infra/opinet/client";
import { geocodeStation, type GeocodeResult, type GeocodeInput } from "@/infra/geocode/geocode-station";
import { getDb, type Db } from "@/infra/db/client";
import { env } from "@/infra/env";
import {
  getLastSuccessfulImport,
  getExistingStationCoords,
  resetStaging,
  loadStaging,
  swapStagingToRefuelPoint,
  writeCsvImportLog,
  type StagingRow,
} from "@/infra/db/repositories";

const GEOCODE_CONCURRENCY = 8;

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
};

export interface PriceImportInput {
  /** 주유소 CSV 원본 바이트 (EUC-KR) */
  oilCsv: Buffer | ArrayBuffer;
  /** 충전소 CSV 원본 바이트 (EUC-KR) */
  lpgCsv: Buffer | ArrayBuffer;
}

export interface PriceImportDeps {
  db?: Db;
  redis?: RedisLike;
  prefix?: string;
  /** 지오코딩 함수 주입 (테스트용). 기본은 카카오 실호출 */
  geocode?: (input: GeocodeInput) => Promise<GeocodeResult | null>;
  /** 지역→SIGUNCD 매핑 주입 (테스트용). 기본은 Redis 캐시 or 오피넷 17회 */
  sigunMap?: Map<string, string>;
}

export type PriceImportResult =
  | {
      status: "OK";
      pricedOn: string;
      oilRows: number;
      lpgRows: number;
      geocoded: number;
      /** 좌표를 못 구해 이번 임포트에서 제외된 행 수 */
      skippedNoCoord: number;
    }
  | { status: "GATE_FAILED"; gate: string; detail: string; pricedOn: string | null };

/** parse.ts가 던진 예외 메시지를 게이트 코드로 분류 (G1 헤더 / G2 기준일자). */
function classifyParseError(message: string): { gate: string; detail: string } {
  if (message.includes("기준일자")) return { gate: "G2", detail: message };
  return { gate: "G1", detail: message };
}

export async function importPrices(
  input: PriceImportInput,
  deps: PriceImportDeps = {},
): Promise<PriceImportResult> {
  const db = deps.db ?? getDb();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const geocode = deps.geocode ?? geocodeStation;

  // ── STEP 1: 디코딩 + 파싱 (G1·G2는 여기서 throw) ──────────────────────────
  let oilParsed: ReturnType<typeof parseOilCsv>;
  let lpgParsed: ReturnType<typeof parseLpgCsv>;
  try {
    oilParsed = parseOilCsv(decodeEucKr(input.oilCsv));
    lpgParsed = parseLpgCsv(decodeEucKr(input.lpgCsv));
  } catch (err) {
    const { gate, detail } = classifyParseError(err instanceof Error ? err.message : String(err));
    await writeCsvImportLog({ pricedOn: null, status: "GATE_FAILED", failedGate: gate, detail }, db);
    return { status: "GATE_FAILED", gate, detail, pricedOn: null };
  }

  const pricedOn = oilParsed.pricedOn;

  // ── STEP 2: 지역→SIGUNCD 매핑 + 병합 ─────────────────────────────────────
  const sigunMap = deps.sigunMap ?? (await getSigunMap({ redis: deps.redis, prefix }));
  const merged = mergeCsvRows(oilParsed.rows, lpgParsed.rows, sigunMap, pricedOn);

  // ── STEP 3: DB 컨텍스트 조회 + 게이트 G3~G8 ─────────────────────────────
  const [prev, existingCoords] = await Promise.all([
    getLastSuccessfulImport(db),
    getExistingStationCoords(db),
  ]);
  const existingIds: ReadonlySet<string> = new Set(existingCoords.keys());

  const ctx: GateContext = {
    merged,
    oilIds: oilParsed.rows.map((r) => r.uniId),
    lpgIds: lpgParsed.rows.map((r) => r.uniId),
    pricedOn,
    prev,
    existingIds,
  };
  const gate = runGates(ctx);
  if (!gate.ok) {
    await writeCsvImportLog(
      {
        pricedOn,
        status: "GATE_FAILED",
        failedGate: gate.gate,
        detail: gate.detail,
        oilRows: oilParsed.rows.length,
        lpgRows: lpgParsed.rows.length,
      },
      db,
    );
    return { status: "GATE_FAILED", gate: gate.gate, detail: gate.detail, pricedOn };
  }

  // ── STEP 4: 좌표 조달 — 신규 행 + 기존 좌표결손 행만 지오코딩 ────────────
  const needsGeocode = merged.filter((m) => existingCoords.get(m.uniId)?.lat == null);
  const geocoded = new Map<string, GeocodeResult>();
  const semaphore = createSemaphore(GEOCODE_CONCURRENCY);
  await Promise.all(
    needsGeocode.map((row) =>
      semaphore.run(async () => {
        const result = await geocode({ address: row.address, name: row.name });
        if (result) geocoded.set(row.uniId, result);
      }),
    ),
  );

  // ── STEP 5: 스테이징 행 조립 (좌표 있는 행만) ───────────────────────────
  const staging: StagingRow[] = [];
  let skippedNoCoord = 0;
  for (const row of merged) {
    const coord = resolveCoord(existingCoords.get(row.uniId), geocoded.get(row.uniId));
    if (!coord) {
      skippedNoCoord++;
      continue;
    }
    staging.push({
      id: row.uniId,
      name: row.name,
      brandCode: row.brandCode,
      energyType: row.energyType,
      lat: coord.lat,
      lng: coord.lng,
      coordSource: coord.coordSource,
      addressRoad: row.address,
      sigunCd: row.sigunCd,
      isSelf: row.isSelf,
      pricedOn: row.pricedOn,
      lastSeenOn: row.lastSeenOn,
      priceGasoline: row.priceGasoline,
      priceDiesel: row.priceDiesel,
      priceLpg: row.priceLpg,
      pricePremium: row.pricePremium,
      priceKerosene: row.priceKerosene,
    });
  }

  // ── STEP 6: 스테이징 적재 → 원자적 스왑 → 정리 ─────────────────────────
  await resetStaging(db);
  await loadStaging(staging, db);
  await swapStagingToRefuelPoint(db);
  await resetStaging(db);

  // ── STEP 7: 이력 기록 ──────────────────────────────────────────────────
  await writeCsvImportLog(
    {
      pricedOn,
      status: "OK",
      oilRows: oilParsed.rows.length,
      lpgRows: lpgParsed.rows.length,
      geocoded: geocoded.size,
    },
    db,
  );

  return {
    status: "OK",
    pricedOn,
    oilRows: oilParsed.rows.length,
    lpgRows: lpgParsed.rows.length,
    geocoded: geocoded.size,
    skippedNoCoord,
  };
}

/** 기존 오피넷 실좌표 > 이번에 지오코딩한 값 > 없음. */
function resolveCoord(
  existing: { lat: number | null; lng: number | null; coordSource: string | null } | undefined,
  fresh: GeocodeResult | undefined,
): GeocodeResult | null {
  if (existing?.lat != null && existing.lng != null) {
    return {
      lat: existing.lat,
      lng: existing.lng,
      coordSource: (existing.coordSource as GeocodeResult["coordSource"]) ?? "OPINET",
    };
  }
  return fresh ?? null;
}
