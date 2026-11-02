import { describe, expect, it } from "vitest";
import { evaluateImportTriggerResult } from "../price-import-trigger-result";

describe("evaluateImportTriggerResult", () => {
  const expected = "2026-11-01";

  it("기대 기준일의 OK만 성공 처리한다", () => {
    expect(evaluateImportTriggerResult({ status: "OK", pricedOn: expected }, expected)).toEqual({
      ok: true,
      alreadyImported: false,
      message: "기준일 2026-11-01 임포트 완료",
    });
    expect(evaluateImportTriggerResult({ status: "OK", pricedOn: "2026-10-31" }, expected)).toMatchObject({
      ok: false,
    });
  });

  it("같은 기준일의 G3는 이미 반영된 멱등 성공으로 처리한다", () => {
    expect(
      evaluateImportTriggerResult(
        { status: "GATE_FAILED", gate: "G3", pricedOn: expected, detail: "이미 반영" },
        expected,
      ),
    ).toMatchObject({ ok: true, alreadyImported: true });
  });

  it("오래된 G3와 다른 게이트 실패는 실패 처리한다", () => {
    expect(
      evaluateImportTriggerResult(
        { status: "GATE_FAILED", gate: "G3", pricedOn: "2026-10-31" },
        expected,
      ),
    ).toMatchObject({ ok: false });
    expect(
      evaluateImportTriggerResult(
        { status: "GATE_FAILED", gate: "G4", pricedOn: expected, detail: "행 수 급감" },
        expected,
      ),
    ).toMatchObject({ ok: false });
  });

  it("DOWNLOAD_FAILED와 알 수 없는 응답을 실패 처리한다", () => {
    expect(evaluateImportTriggerResult({ status: "DOWNLOAD_FAILED", detail: "Blob 없음" }, expected)).toMatchObject({
      ok: false,
    });
    expect(evaluateImportTriggerResult("Vercel timeout", expected)).toMatchObject({ ok: false });
  });
});
