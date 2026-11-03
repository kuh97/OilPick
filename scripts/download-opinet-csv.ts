/**
 * 오피넷 과거 판매가격 CSV 다운로드 → Vercel Blob 업로드 → 임포트 트리거.
 * docs/MIGRATION-DB.md §7 Phase D. GitHub Actions(.github/workflows/opinet-daily.yml)가
 * 매일 실행합니다.
 *
 * 사용법:
 *   pnpm data:download-csv            # KST 어제 날짜
 *   pnpm data:download-csv 20260904   # 날짜 지정
 *
 * 필요 환경변수:
 *   BLOB_READ_WRITE_TOKEN   (필수 — Blob 업로드)
 *   APP_BASE_URL, CRON_SECRET (선택 — 있으면 임포트 엔드포인트를 바로 호출)
 */

import { downloadPriceCsv, resolveDownloadDate } from "@/infra/opinet/download";
import { putPriceCsvs } from "@/infra/blob/price-csv";
import { validateDownloadedPriceCsvs } from "@/infra/csv/validate-download";
import { evaluateImportTriggerResult } from "@/services/price-import-trigger-result";
import { requireEnv, header, ok, warn } from "./_shared";

async function main() {
  requireEnv(["BLOB_READ_WRITE_TOKEN"]);
  const targetDate = resolveDownloadDate(process.argv[2]);

  header(`오피넷 CSV 다운로드 (요청일 ${targetDate})`);
  const { oil, lpg } = await downloadPriceCsv(targetDate);
  const validated = validateDownloadedPriceCsvs(oil, lpg, targetDate);
  ok(
    `기준일 ${validated.pricedOn}, 주유소 ${validated.oilRows}행 ${(oil.byteLength / 1024).toFixed(0)}KB, ` +
      `충전소 ${validated.lpgRows}행 ${(lpg.byteLength / 1024).toFixed(0)}KB`,
  );

  header("Vercel Blob 업로드");
  await putPriceCsvs(oil, lpg, validated.archiveDate);
  ok(`opinet/latest/{oil,lpg}.csv + archive/{oil,lpg}-${validated.archiveDate}.csv`);

  const base = process.env.APP_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (base && secret) {
    header("임포트 엔드포인트 호출");
    const importUrl = new URL(`${base}/api/cron/import-prices`);
    importUrl.searchParams.set("date", validated.archiveDate);
    const res = await fetch(importUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const bodyText = await res.text();
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      // Vercel timeout 페이지 등 JSON이 아닌 응답은 원문을 그대로 보여준다.
    }
    if (!res.ok) {
      throw new Error(`임포트 엔드포인트 실패: HTTP ${res.status} ${JSON.stringify(body)}`);
    }
    const decision = evaluateImportTriggerResult(body, validated.pricedOn);
    if (!decision.ok) {
      throw new Error(decision.detail);
    }
    if (decision.alreadyImported) warn(decision.message);
    else ok(`${res.status} ${decision.message}`);
  } else {
    warn("APP_BASE_URL/CRON_SECRET 없음 — 임포트는 Vercel Cron 스케줄에 맡깁니다");
  }
}

main().catch((err: unknown) => {
  console.error("✖ CSV 수급 파이프라인 실패:", err);
  process.exitCode = 1;
});
