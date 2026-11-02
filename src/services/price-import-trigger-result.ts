export type ImportTriggerDecision =
  | { ok: true; alreadyImported: boolean; message: string }
  | { ok: false; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** GitHub Actions가 HTTP 200 안의 실제 임포트 결과를 성공/실패로 판정합니다. */
export function evaluateImportTriggerResult(
  body: unknown,
  expectedPricedOn: string,
): ImportTriggerDecision {
  if (!isRecord(body) || typeof body.status !== "string") {
    return { ok: false, detail: `임포트 응답 형식이 올바르지 않습니다: ${JSON.stringify(body)}` };
  }

  const pricedOn = typeof body.pricedOn === "string" ? body.pricedOn : null;
  if (body.status === "OK") {
    if (pricedOn !== expectedPricedOn) {
      return {
        ok: false,
        detail: `임포트 기준일자가 다릅니다: 예상=${expectedPricedOn}, 실제=${pricedOn ?? "없음"}`,
      };
    }
    return { ok: true, alreadyImported: false, message: `기준일 ${pricedOn} 임포트 완료` };
  }

  // GitHub 트리거보다 Vercel Cron이 먼저 같은 파일을 반영한 경우는 멱등 성공입니다.
  if (body.status === "GATE_FAILED" && body.gate === "G3" && pricedOn === expectedPricedOn) {
    return {
      ok: true,
      alreadyImported: true,
      message: `기준일 ${pricedOn}은 이미 임포트되어 있습니다`,
    };
  }

  const gate = typeof body.gate === "string" ? ` ${body.gate}` : "";
  const detail = typeof body.detail === "string" ? `: ${body.detail}` : "";
  return { ok: false, detail: `임포트 실패 (${body.status}${gate})${detail}` };
}
