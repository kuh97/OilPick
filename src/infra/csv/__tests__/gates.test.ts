import { describe, expect, it } from "vitest";
import { runGates, type GateContext, type PrevImportStats } from "../gates";
import type { MergedCsvRow } from "../types";

function row(overrides: Partial<MergedCsvRow> = {}): MergedCsvRow {
  return {
    uniId: "A1234567",
    name: "테스트주유소",
    address: "서울 강남구 테헤란로 1",
    sigunCd: "0101",
    brandCode: "SKE",
    isSelf: false,
    energyType: "OIL",
    priceGasoline: 1700,
    priceDiesel: 1600,
    priceLpg: null,
    pricePremium: null,
    priceKerosene: null,
    pricedOn: "2026-09-05",
    lastSeenOn: "2026-09-05",
    ...overrides,
  };
}

function ctx(overrides: Partial<GateContext> = {}): GateContext {
  const merged =
    overrides.merged ??
    Array.from({ length: 100 }, (_, i) => row({ uniId: `A${String(i).padStart(7, "0")}` }));
  return {
    merged,
    oilIds: overrides.oilIds ?? merged.map((r) => r.uniId),
    lpgIds: overrides.lpgIds ?? [],
    pricedOn: overrides.pricedOn ?? "2026-09-05",
    prev: overrides.prev ?? null,
    existingIds: overrides.existingIds ?? new Set(),
  };
}

const prev: PrevImportStats = { pricedOn: "2026-09-04", oilRows: 100, lpgRows: 0 };

describe("runGates", () => {
  it("prev=null · existingIds=∅ → G3·G4·G6 자동 통과, 정상 데이터면 ok", () => {
    expect(runGates(ctx())).toEqual({ ok: true });
  });

  it("G3 — 기준일자가 직전과 같으면 실패 (같은 파일 재수입)", () => {
    const r = runGates(ctx({ prev, pricedOn: "2026-09-04" }));
    expect(r).toMatchObject({ ok: false, gate: "G3" });
  });

  it("G3 — 기준일자가 더 새로우면 통과", () => {
    expect(runGates(ctx({ prev, pricedOn: "2026-09-05" })).ok).toBe(true);
  });

  it("G4 — 행 수가 직전 대비 10% 넘게 줄면 실패 (잘린 파일)", () => {
    const merged = Array.from({ length: 80 }, (_, i) => row({ uniId: `A${String(i).padStart(7, "0")}` }));
    const r = runGates(ctx({ merged, prev, pricedOn: "2026-09-05" }));
    expect(r).toMatchObject({ ok: false, gate: "G4" });
  });

  it("G4 — ±10% 이내면 통과", () => {
    const merged = Array.from({ length: 105 }, (_, i) => row({ uniId: `A${String(i).padStart(7, "0")}` }));
    expect(runGates(ctx({ merged, prev, pricedOn: "2026-09-05" })).ok).toBe(true);
  });

  it("G5 — UNI_ID 형식 이탈이 있으면 실패", () => {
    const merged = [row({ uniId: "BAD-ID" }), ...ctx().merged];
    const r = runGates(ctx({ merged }));
    expect(r).toMatchObject({ ok: false, gate: "G5" });
  });

  it("G5 — 원본 CSV 내 UNI_ID 중복이 있으면 실패", () => {
    const r = runGates(ctx({ oilIds: ["A0000001", "A0000001", "A0000002"] }));
    expect(r).toMatchObject({ ok: false, gate: "G5" });
  });

  it("G6 — 기존 마스터와 교집합 90% 미만이면 실패 (전혀 다른 데이터셋)", () => {
    const existingIds = new Set(Array.from({ length: 100 }, (_, i) => `Z${String(i).padStart(7, "0")}`));
    const r = runGates(ctx({ existingIds }));
    expect(r).toMatchObject({ ok: false, gate: "G6" });
  });

  it("G6 — 교집합 90% 이상이면 통과", () => {
    const existingIds = new Set(ctx().merged.slice(0, 95).map((r) => r.uniId));
    expect(runGates(ctx({ existingIds })).ok).toBe(true);
  });

  it("G7 — 휘발유 유효행 비율 95% 미만이면 실패 (가격 컬럼 밀림)", () => {
    const merged = ctx().merged.map((r, i) => (i < 10 ? row({ ...r, priceGasoline: null }) : r));
    const res = runGates(ctx({ merged }));
    expect(res).toMatchObject({ ok: false, gate: "G7" });
  });

  it("G8 — 정상 범위 밖 가격이 0.5% 이상이면 실패 (단위 변경)", () => {
    const merged = ctx().merged.map((r, i) => (i < 2 ? row({ ...r, priceGasoline: 17_000 }) : r));
    const res = runGates(ctx({ merged }));
    expect(res).toMatchObject({ ok: false, gate: "G8" });
  });

  it("게이트는 순서대로 검사 — G3가 G7보다 먼저 잡힌다", () => {
    const merged = ctx().merged.map((r, i) => (i < 50 ? row({ ...r, priceGasoline: null }) : r));
    const r = runGates(ctx({ merged, prev, pricedOn: "2026-09-04" })); // G3도 G7도 실패 상황
    expect(r).toMatchObject({ ok: false, gate: "G3" });
  });
});
