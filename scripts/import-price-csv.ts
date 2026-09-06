/**
 * 오피넷 유가 CSV(과거 판매가격) → refuel_point 임포트 (1회성 마스터 구축).
 * docs/MIGRATION-DB.md §7 Phase A.
 *
 * 일일 자동 갱신(Phase D)은 services/price-import-service.ts가 담당하며, 파싱·게이트·
 * 지오코딩·시군구 매핑 로직을 이 스크립트와 **공유**합니다(ARCHITECTURE.md §9.3).
 * 이 스크립트는 로컬 파일에서 읽고, 게이트는 G3·G4·G6(직전 임포트 참조)을 건너뜁니다.
 *
 * 사용법:
 *   pnpm data:import-csv                                    # data/csv/ 밑에서 자동 탐색
 *   pnpm data:import-csv <주유소.csv> <충전소.csv>            # 경로 직접 지정
 */

import fs from "node:fs";
import path from "node:path";
import { createSemaphore } from "@/infra/opinet/client";
import { getDb } from "@/infra/db/client";
import { refuelPoint } from "@/infra/db/schema";
import { bulkUpsertFromCsv, type CsvUpsertRow } from "@/infra/db/repositories";
import { decodeEucKr, parseOilCsv, parseLpgCsv, mergeCsvRows } from "@/infra/csv/parse";
import { runGates, type GateContext } from "@/infra/csv/gates";
import { getSigunMap } from "@/infra/opinet/sigun-map";
import { geocodeStation, type GeocodeResult } from "@/infra/geocode/geocode-station";
import type { MergedCsvRow } from "@/infra/csv/types";
import { requireEnv, header, info, ok, warn, fail } from "./_shared";

const CHUNK_SIZE = 500;
const GEOCODE_CONCURRENCY = 8;

// ─── CSV 파일 탐색 ────────────────────────────────────────────────────────────

function findDefaultCsv(dir: string, mustContain: string): string {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv") && f.includes(mustContain));
  if (files.length === 0) {
    throw new Error(`${dir}에서 "${mustContain}"이 포함된 CSV를 찾을 수 없습니다.`);
  }
  if (files.length > 1) {
    throw new Error(`${dir}에서 "${mustContain}" CSV가 여러 개 발견됐습니다: ${files.join(", ")}`);
  }
  return path.join(dir, files[0]);
}

function resolveCsvPaths(): { oilPath: string; lpgPath: string } {
  const [, , argOil, argLpg] = process.argv;
  if (argOil && argLpg) return { oilPath: argOil, lpgPath: argLpg };
  const dir = path.join(process.cwd(), "data", "csv");
  return {
    oilPath: findDefaultCsv(dir, "주유소"),
    lpgPath: findDefaultCsv(dir, "충전소"),
  };
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  requireEnv(["DATABASE_URL", "KAKAO_REST_API_KEY", "OPINET_CERT_KEY"]);

  const { oilPath, lpgPath } = resolveCsvPaths();
  header("CSV 파싱");
  info(`주유소: ${oilPath}`);
  info(`충전소: ${lpgPath}`);

  const oilParsed = parseOilCsv(decodeEucKr(fs.readFileSync(oilPath)));
  const lpgParsed = parseLpgCsv(decodeEucKr(fs.readFileSync(lpgPath)));
  if (oilParsed.pricedOn !== lpgParsed.pricedOn) {
    warn(`두 CSV의 기준일자가 다릅니다: 주유소=${oilParsed.pricedOn}, 충전소=${lpgParsed.pricedOn}`);
  }
  ok(`주유소 ${oilParsed.rows.length}행, 충전소 ${lpgParsed.rows.length}행, 기준일자 ${oilParsed.pricedOn}`);

  header("시군구 코드 매핑 (오피넷 areaCode.do + avgSigunPrice.do, 예상 호출 17회)");
  const sigunMap = await getSigunMap({ forceRefresh: true });
  ok(`시군구 매핑 ${sigunMap.size}개 확보`);

  const merged = mergeCsvRows(oilParsed.rows, lpgParsed.rows, sigunMap, oilParsed.pricedOn);
  const unmappedSigun = merged.filter((m) => m.sigunCd === null).length;
  if (unmappedSigun > 0) warn(`SIGUNCD 매핑 실패 ${unmappedSigun}건 (P_ref 시군구 집계에서 제외됨)`);

  // 1회성 구축이라 직전 임포트 참조 게이트(G3·G4·G6)는 건너뛴다 — prev=null,
  // existingIds=∅로 넘기면 runGates가 자동으로 G3·G4·G6을 통과시키고 G5·G7·G8만 본다.
  header("검증 (G5·G7·G8)");
  const ctx: GateContext = {
    merged,
    oilIds: oilParsed.rows.map((r) => r.uniId),
    lpgIds: lpgParsed.rows.map((r) => r.uniId),
    pricedOn: oilParsed.pricedOn,
    prev: null,
    existingIds: new Set(),
  };
  const gate = runGates(ctx);
  if (!gate.ok) {
    fail(`${gate.gate} — ${gate.detail}`);
    throw new Error(`${gate.gate} 검증 실패 — 임포트를 중단합니다.`);
  }
  ok("G5·G7·G8 통과");

  // 기존 좌표 재사용 — 오피넷 실좌표가 있으면 지오코딩하지 않음 (§4)
  header("좌표 조달");
  const db = getDb();
  const existingCoords = await db
    .select({ id: refuelPoint.id, lat: refuelPoint.lat, lng: refuelPoint.lng, coordSource: refuelPoint.coordSource })
    .from(refuelPoint);
  const existingMap = new Map(existingCoords.map((r) => [r.id, r]));
  info(`기존 마스터 ${existingMap.size}건 — 좌표 보유분은 지오코딩 스킵`);

  const needsGeocode = merged.filter((m) => existingMap.get(m.uniId)?.lat == null);
  info(`지오코딩 대상: ${needsGeocode.length}건 (카카오 API, 동시성 ${GEOCODE_CONCURRENCY})`);

  const semaphore = createSemaphore(GEOCODE_CONCURRENCY);
  const geocoded = new Map<string, GeocodeResult>();
  let doneCount = 0;
  let viaAddressCount = 0;
  let viaKeywordCount = 0;
  const failed: MergedCsvRow[] = [];

  await Promise.all(
    needsGeocode.map((row) =>
      semaphore.run(async () => {
        const result = await geocodeStation({ address: row.address, name: row.name });
        doneCount++;
        if (doneCount % 1000 === 0) info(`진행 ${doneCount}/${needsGeocode.length}`);
        if (result) {
          geocoded.set(row.uniId, result);
          if (result.coordSource === "KAKAO_ADDR") viaAddressCount++;
          else viaKeywordCount++;
        } else {
          failed.push(row);
        }
      }),
    ),
  );
  ok(`지오코딩 완료 — 주소검색 ${viaAddressCount}건, 키워드검색 ${viaKeywordCount}건, 실패 ${failed.length}건`);

  if (failed.length > 0) {
    const logPath = path.join(process.cwd(), "data", "csv", "geocode-failures.json");
    fs.writeFileSync(
      logPath,
      JSON.stringify(failed.map((f) => ({ id: f.uniId, name: f.name, address: f.address })), null, 2),
    );
    warn(`좌표를 못 구한 ${failed.length}건은 이번 임포트에서 제외 — ${logPath}에 기록`);
  }

  // upsert 대상 조립
  const upsertRows: CsvUpsertRow[] = [];
  const skippedIds = new Set(failed.map((f) => f.uniId));
  for (const row of merged) {
    if (skippedIds.has(row.uniId)) continue;
    const existing = existingMap.get(row.uniId);
    const coord: GeocodeResult =
      existing?.lat != null && existing?.lng != null
        ? { lat: existing.lat, lng: existing.lng, coordSource: (existing.coordSource as GeocodeResult["coordSource"]) ?? "OPINET" }
        : geocoded.get(row.uniId)!;

    upsertRows.push({
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

  header(`DB 적재 (${upsertRows.length}건, ${CHUNK_SIZE}건씩 청크)`);
  let upserted = 0;
  for (let i = 0; i < upsertRows.length; i += CHUNK_SIZE) {
    const chunk = upsertRows.slice(i, i + CHUNK_SIZE);
    await bulkUpsertFromCsv(chunk, db);
    upserted += chunk.length;
    info(`${upserted}/${upsertRows.length}`);
  }

  header("완료");
  ok(`refuel_point upsert ${upserted}건 (기준일자 ${oilParsed.pricedOn})`);
  if (failed.length > 0) ok(`좌표 미확보 ${failed.length}건은 다음 실행에서 재시도 가능 (제외됨)`);
}

main().catch((err: unknown) => {
  console.error("✖ CSV 임포트 실패:", err);
  process.exitCode = 1;
});
