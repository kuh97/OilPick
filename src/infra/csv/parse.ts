/**
 * 오피넷 유가 CSV(과거 판매가격) 파싱 — docs/MIGRATION-DB.md §3·§7 Phase A.
 * 전부 순수 함수(파일 I/O 없음) — 인코딩 디코딩과 DB 접근은 scripts/import-price-csv.ts가 맡습니다.
 */

import { parse } from "csv-parse/sync";
import type { RawOilRow, RawLpgRow, MergedCsvRow } from "./types";

export type CsvParseGate = "G1" | "G2";

export class CsvParseError extends Error {
  constructor(
    public readonly gate: CsvParseGate,
    message: string,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

// ─── 브랜드 코드 매핑 (docs/MIGRATION-DB.md §3.3 실측 대조표) ───────────────────
// POLL_DIV_CD를 정본으로 삼습니다. CSV '상표' 텍스트는 이 표로만 역변환합니다.

export const BRAND_LABEL_TO_CODE: Record<string, string> = {
  "SK에너지": "SKE",
  "GS칼텍스": "GSC",
  "HD현대오일뱅크": "HDO",
  "S-OIL": "SOL",
  "NH-OIL": "NHO",
  "알뜰주유소": "RTO",
  "알뜰(ex)": "RTX",
  "자가상표": "ETC",
  "E1": "E1G",
  "SK가스": "SKG",
};

/** 매핑표에 없는 상표는 원본 텍스트를 그대로 코드처럼 씁니다(신규 브랜드 대비 — 죽지 않고 계속 진행). */
export function mapBrandLabel(label: string): string {
  return BRAND_LABEL_TO_CODE[label] ?? label;
}

// ─── 공통 유틸 ────────────────────────────────────────────────────────────────

/** EUC-KR로 인코딩된 오피넷 CSV 원본을 UTF-8 문자열로 디코딩. Node 내장 TextDecoder로 충분(실측 확인). */
export function decodeEucKr(buf: Buffer | ArrayBuffer): string {
  return new TextDecoder("euc-kr").decode(buf);
}

/**
 * 2번째 행("기준 : 일간(20260904~20260904)")에서 기준일자를 뽑아 ISO 날짜로 변환.
 * docs/MIGRATION-DB.md 검증 게이트 G2.
 */
export function parseMetaDate(metaLine: string): string {
  const match = metaLine.match(/일간\s*\(\s*(\d{8})\s*~\s*(\d{8})\s*\)/);
  if (!match) {
    throw new CsvParseError("G2", `메타행에서 기준일자를 찾을 수 없습니다: "${metaLine}"`);
  }
  const [, start, end] = match;
  if (start !== end) {
    throw new CsvParseError("G2", `일일 CSV의 시작일과 종료일이 다릅니다: "${metaLine}"`);
  }

  const iso = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new CsvParseError("G2", `메타행의 기준일자가 유효하지 않습니다: "${metaLine}"`);
  }
  return iso;
}

function assertRowDates(dataRows: string[][], pricedOn: string, label: string): void {
  const expected = pricedOn.replace(/-/g, "");
  const mismatch = dataRows.find((row) => row[4] !== expected);
  if (mismatch) {
    throw new CsvParseError(
      "G2",
      `${label} CSV 행의 기간 ${mismatch[4] ?? "(없음)"}이 메타 기준일자 ${expected}와 다릅니다(G2)`,
    );
  }
}

/** "0"은 미취급(무료 아님) — null로 정규화. A3 규칙과 동일(오피넷 반경검색 price<=0 제외). */
function parsePriceOrNull(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const OIL_HEADER = [
  "번호", "지역", "상호", "주소", "기간", "상표", "셀프여부",
  "고급휘발유", "휘발유", "경유", "실내등유",
] as const;

const LPG_HEADER = ["번호", "지역", "상호", "주소", "기간", "상표", "셀프여부", "LPG"] as const;

function assertHeader(actual: string[] | undefined, expected: readonly string[], label: string): void {
  if (!actual) {
    throw new CsvParseError("G1", `${label} CSV 헤더가 없습니다(G1)`);
  }
  const ok = actual.length === expected.length && expected.every((h, i) => actual[i] === h);
  if (!ok) {
    throw new CsvParseError(
      "G1",
      `${label} CSV 헤더가 예상과 다릅니다(G1). 예상: [${expected.join(",")}] 실제: [${actual.join(",")}]`,
    );
  }
}

// ─── 주유소 CSV ───────────────────────────────────────────────────────────────

export interface ParsedOilCsv {
  pricedOn: string;
  rows: RawOilRow[];
}

/** UTF-8로 디코딩된 주유소 CSV 전체 텍스트를 파싱합니다. */
export function parseOilCsv(text: string): ParsedOilCsv {
  const records: string[][] = parse(text, { skip_empty_lines: true, relax_column_count: true });
  const [header, metaRow, ...dataRows] = records;
  assertHeader(header, OIL_HEADER, "주유소");
  if (!metaRow?.[0]) throw new CsvParseError("G2", "주유소 CSV 메타행이 없습니다(G2)");
  const pricedOn = parseMetaDate(metaRow[0]);
  assertRowDates(dataRows, pricedOn, "주유소");

  const rows: RawOilRow[] = dataRows.map((r) => ({
    uniId: r[0],
    region: r[1],
    name: r[2],
    address: r[3],
    brandLabel: r[5],
    isSelf: r[6] === "셀프",
    pricePremium: parsePriceOrNull(r[7]),
    priceGasoline: parsePriceOrNull(r[8]),
    priceDiesel: parsePriceOrNull(r[9]),
    priceKerosene: parsePriceOrNull(r[10]),
  }));

  return { pricedOn, rows };
}

// ─── 충전소 CSV ───────────────────────────────────────────────────────────────

export interface ParsedLpgCsv {
  pricedOn: string;
  rows: RawLpgRow[];
}

export function parseLpgCsv(text: string): ParsedLpgCsv {
  const records: string[][] = parse(text, { skip_empty_lines: true, relax_column_count: true });
  const [header, metaRow, ...dataRows] = records;
  assertHeader(header, LPG_HEADER, "충전소");
  if (!metaRow?.[0]) throw new CsvParseError("G2", "충전소 CSV 메타행이 없습니다(G2)");
  const pricedOn = parseMetaDate(metaRow[0]);
  assertRowDates(dataRows, pricedOn, "충전소");

  const rows: RawLpgRow[] = dataRows.map((r) => ({
    uniId: r[0],
    region: r[1],
    name: r[2],
    address: r[3],
    brandLabel: r[5],
    isSelf: r[6] === "셀프",
    priceLpg: parsePriceOrNull(r[7]),
  }));

  return { pricedOn, rows };
}

export interface ParsedPriceCsvPair {
  oil: ParsedOilCsv;
  lpg: ParsedLpgCsv;
  pricedOn: string;
}

/** 주유소·LPG CSV를 함께 파싱하고 두 파일이 같은 일자 스냅샷인지 검증합니다. */
export function parsePriceCsvPair(oilText: string, lpgText: string): ParsedPriceCsvPair {
  const oil = parseOilCsv(oilText);
  const lpg = parseLpgCsv(lpgText);
  if (oil.pricedOn !== lpg.pricedOn) {
    throw new CsvParseError(
      "G2",
      `주유소/LPG CSV 기준일자가 다릅니다(G2): 주유소=${oil.pricedOn}, LPG=${lpg.pricedOn}`,
    );
  }
  return { oil, lpg, pricedOn: oil.pricedOn };
}

// ─── 병합 ─────────────────────────────────────────────────────────────────────

/**
 * 주유소·충전소 CSV를 UNI_ID 기준으로 병합.
 * 두 CSV 모두에 있는 UNI_ID(겸업, docs/MIGRATION-DB.md §3.2 — 259건 실측)는
 * energyType=BOTH로 합쳐집니다.
 *
 * @param sigunMap CSV '지역' 텍스트 → SIGUNCD. 오피넷 avgSigunPrice.do의 SIGUNNM과
 *   글자 단위로 정확히 일치합니다(정규화 불필요 — 실측 230/230 매칭 확인).
 */
export function mergeCsvRows(
  oilRows: RawOilRow[],
  lpgRows: RawLpgRow[],
  sigunMap: ReadonlyMap<string, string>,
  pricedOn: string,
): MergedCsvRow[] {
  const byId = new Map<string, MergedCsvRow>();

  for (const r of oilRows) {
    byId.set(r.uniId, {
      uniId: r.uniId,
      name: r.name,
      address: r.address,
      sigunCd: sigunMap.get(r.region) ?? null,
      brandCode: mapBrandLabel(r.brandLabel),
      isSelf: r.isSelf,
      energyType: "OIL",
      priceGasoline: r.priceGasoline,
      priceDiesel: r.priceDiesel,
      priceLpg: null,
      pricePremium: r.pricePremium,
      priceKerosene: r.priceKerosene,
      pricedOn,
      lastSeenOn: pricedOn,
    });
  }

  for (const r of lpgRows) {
    const existing = byId.get(r.uniId);
    if (existing) {
      existing.priceLpg = r.priceLpg;
      existing.energyType = "BOTH";
    } else {
      byId.set(r.uniId, {
        uniId: r.uniId,
        name: r.name,
        address: r.address,
        sigunCd: sigunMap.get(r.region) ?? null,
        brandCode: mapBrandLabel(r.brandLabel),
        isSelf: r.isSelf,
        energyType: "LPG",
        priceGasoline: null,
        priceDiesel: null,
        priceLpg: r.priceLpg,
        pricePremium: null,
        priceKerosene: null,
        pricedOn,
        lastSeenOn: pricedOn,
      });
    }
  }

  return [...byId.values()];
}
