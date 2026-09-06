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

import { downloadPriceCsv } from "@/infra/opinet/download";
import { putPriceCsvs } from "@/infra/blob/price-csv";
import { requireEnv, header, info, ok, warn } from "./_shared";

async function main() {
  requireEnv(["BLOB_READ_WRITE_TOKEN"]);
  const date = process.argv[2]; // "YYYYMMDD" | undefined → 모듈이 KST 어제로 채움

  header(`오피넷 CSV 다운로드 ${date ?? "(KST 어제)"}`);
  const { oil, lpg } = await downloadPriceCsv(date);
  ok(`주유소 ${(oil.byteLength / 1024).toFixed(0)}KB, 충전소 ${(lpg.byteLength / 1024).toFixed(0)}KB`);

  const stamp = date ?? new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
  header("Vercel Blob 업로드");
  await putPriceCsvs(oil, lpg, stamp);
  ok(`opinet/latest/{oil,lpg}.csv + archive/{oil,lpg}-${stamp}.csv`);

  const base = process.env.APP_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (base && secret) {
    header("임포트 엔드포인트 호출");
    const res = await fetch(`${base}/api/cron/import-prices`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.json().catch(() => ({}));
    ok(`${res.status} ${JSON.stringify(body)}`);
  } else {
    warn("APP_BASE_URL/CRON_SECRET 없음 — 임포트는 Vercel Cron 스케줄에 맡깁니다");
  }
}

main().catch((err: unknown) => {
  console.error("✖ 다운로드 실패:", err);
  process.exitCode = 1;
});
