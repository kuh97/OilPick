/**
 * 유가 CSV 검증 게이트 G1~G8 — docs/MIGRATION-DB.md §8.
 *
 * 전부 순수 함수입니다. DB가 필요한 게이트(G3·G4·G6)는 직전 성공 임포트 통계와
 * 기존 ID 집합을 인자로 받습니다 — 조회는 호출부(price-import-service)의 몫입니다.
 *
 * G1(헤더 일치)·G2(기준일자 파싱)는 parse.ts가 파싱 시점에 throw로 강제하므로
 * 여기서 다시 검사하지 않습니다. 호출부가 파싱 예외를 잡아 G1/G2로 분류합니다.
 */

import type { MergedCsvRow } from "./types";

/** G4 행 수 허용 변동폭 — 전국 주유소 수는 연 3~5%만 움직임(§8) */
const ROW_COUNT_TOLERANCE = 0.1;
/** G6 기존 ID 교집합 최소 비율 */
const ID_INTERSECTION_MIN = 0.9;
/** G7 휘발유 유효행 최소 비율 */
const GASOLINE_VALID_MIN = 0.95;
/** G8 가격 정상 범위(원) */
const PRICE_MIN = 1_000;
const PRICE_MAX = 4_000;
/** G8 범위 이탈 허용 비율 */
const PRICE_OUTLIER_MAX = 0.005;

export interface PrevImportStats {
  /** 직전 성공 임포트의 기준일자 "YYYY-MM-DD" */
  pricedOn: string;
  /** 직전 성공 임포트의 주유소 CSV 원본 행 수 */
  oilRows: number;
  /** 직전 성공 임포트의 충전소 CSV 원본 행 수 */
  lpgRows: number;
}

export interface GateContext {
  /** 병합 결과 (UNI_ID 기준 유니크) */
  merged: MergedCsvRow[];
  /** 주유소 CSV 원본 UNI_ID 목록 (병합 전 — 중복 검사용) */
  oilIds: string[];
  /** 충전소 CSV 원본 UNI_ID 목록 */
  lpgIds: string[];
  /** 이번 파일의 기준일자 "YYYY-MM-DD" */
  pricedOn: string;
  /** 직전 성공 임포트 통계. 최초 임포트면 null → G3·G4는 통과 */
  prev: PrevImportStats | null;
  /** refuel_point에 이미 있는 전체 ID. 빈 DB면 G6는 통과 */
  existingIds: ReadonlySet<string>;
}

export type GateResult =
  | { ok: true }
  | { ok: false; gate: string; detail: string };

const UNI_ID_RE = /^A\d{7}$/;

/** G3 — 기준일자가 직전 성공분보다 새로운가 (같은 파일 재수입 차단) */
function g3(ctx: GateContext): GateResult {
  if (!ctx.prev) return { ok: true };
  if (ctx.pricedOn > ctx.prev.pricedOn) return { ok: true };
  return {
    ok: false,
    gate: "G3",
    detail: `기준일자 ${ctx.pricedOn}가 직전 성공분 ${ctx.prev.pricedOn}보다 새롭지 않음`,
  };
}

/** G4 — 행 수가 직전 대비 ±10% 이내인가 (잘린 파일·빈 파일 차단) */
function g4(ctx: GateContext): GateResult {
  if (!ctx.prev) return { ok: true };
  for (const [label, cur, prev] of [
    ["주유소", ctx.oilIds.length, ctx.prev.oilRows],
    ["충전소", ctx.lpgIds.length, ctx.prev.lpgRows],
  ] as const) {
    if (prev === 0) continue;
    const delta = Math.abs(cur - prev) / prev;
    if (delta > ROW_COUNT_TOLERANCE) {
      return {
        ok: false,
        gate: "G4",
        detail: `${label} 행 수 ${cur} (직전 ${prev}, ${(delta * 100).toFixed(1)}% 변동 > ${ROW_COUNT_TOLERANCE * 100}%)`,
      };
    }
  }
  return { ok: true };
}

/** G5 — UNI_ID가 A\d{7} 형식 100%이고 원본 CSV 내 중복이 없는가 */
function g5(ctx: GateContext): GateResult {
  const badFormat = ctx.merged.filter((r) => !UNI_ID_RE.test(r.uniId));
  if (badFormat.length > 0) {
    return {
      ok: false,
      gate: "G5",
      detail: `UNI_ID 형식 이탈 ${badFormat.length}건 (예: ${badFormat[0]?.uniId})`,
    };
  }
  for (const [label, ids] of [
    ["주유소", ctx.oilIds],
    ["충전소", ctx.lpgIds],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      return { ok: false, gate: "G5", detail: `${label} CSV 내 UNI_ID 중복 있음` };
    }
  }
  return { ok: true };
}

/** G6 — 기존 마스터 ID와 90% 이상 겹치는가 (전혀 다른 데이터셋 차단) */
function g6(ctx: GateContext): GateResult {
  if (ctx.existingIds.size === 0) return { ok: true };
  let hit = 0;
  for (const r of ctx.merged) if (ctx.existingIds.has(r.uniId)) hit++;
  const ratio = hit / ctx.existingIds.size;
  if (ratio >= ID_INTERSECTION_MIN) return { ok: true };
  return {
    ok: false,
    gate: "G6",
    detail: `기존 ID 교집합 ${(ratio * 100).toFixed(1)}% (${hit}/${ctx.existingIds.size}) < ${ID_INTERSECTION_MIN * 100}%`,
  };
}

/** G7 — 휘발유 유효행 비율이 95% 이상인가 (가격 컬럼 밀림 차단) */
function g7(ctx: GateContext): GateResult {
  const oilRows = ctx.merged.filter((r) => r.energyType !== "LPG");
  if (oilRows.length === 0) return { ok: true };
  const valid = oilRows.filter((r) => r.priceGasoline != null).length;
  const ratio = valid / oilRows.length;
  if (ratio >= GASOLINE_VALID_MIN) return { ok: true };
  return {
    ok: false,
    gate: "G7",
    detail: `휘발유 유효행 ${(ratio * 100).toFixed(1)}% < ${GASOLINE_VALID_MIN * 100}%`,
  };
}

/** G8 — 정상 범위(1,000~4,000원)를 벗어난 가격이 0.5% 미만인가 (단위 변경·인코딩 깨짐 차단) */
function g8(ctx: GateContext): GateResult {
  const prices = ctx.merged.flatMap((r) =>
    [r.priceGasoline, r.priceDiesel, r.priceLpg, r.pricePremium, r.priceKerosene].filter(
      (p): p is number => p != null,
    ),
  );
  if (prices.length === 0) return { ok: true };
  const outliers = prices.filter((p) => p < PRICE_MIN || p > PRICE_MAX).length;
  const ratio = outliers / prices.length;
  if (ratio < PRICE_OUTLIER_MAX) return { ok: true };
  return {
    ok: false,
    gate: "G8",
    detail: `가격 범위 이탈 ${(ratio * 100).toFixed(2)}% ≥ ${PRICE_OUTLIER_MAX * 100}%`,
  };
}

const GATES = [g3, g4, g5, g6, g7, g8];

/** G3~G8을 순서대로 검사해 처음 실패한 게이트를 반환. 전부 통과하면 { ok: true }. */
export function runGates(ctx: GateContext): GateResult {
  for (const gate of GATES) {
    const result = gate(ctx);
    if (!result.ok) return result;
  }
  return { ok: true };
}
