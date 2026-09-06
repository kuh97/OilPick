/**
 * 일일 유가 CSV 임포트 크론 — docs/MIGRATION-DB.md §7 Phase D.
 *
 * Vercel Cron이 하루 1회 GET으로 부릅니다(vercel.json). GitHub Actions도 Blob 업로드
 * 직후 같은 엔드포인트를 호출해 임포트를 즉시 트리거하고, Cron은 안전망입니다.
 *
 * 실패(다운로드 없음·게이트 탈락)는 200으로 응답합니다 — "어제 데이터로 계속
 * 서비스"가 정상 동작이라, 5xx로 올리면 Vercel이 불필요하게 알람을 냅니다.
 * 결과는 csv_import_log에 남고 결과 화면 배너가 기준일자를 읽습니다.
 */

import { NextResponse } from "next/server";
import { env } from "@/infra/env";
import { getLatestPriceCsvs } from "@/infra/blob/price-csv";
import { importPrices } from "@/services/price-import-service";
import { writeCsvImportLog } from "@/infra/db/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Fluid Compute Hobby 상한 (§12)

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let csvs: { oil: Buffer; lpg: Buffer };
  try {
    csvs = await getLatestPriceCsvs();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await writeCsvImportLog({ pricedOn: null, status: "DOWNLOAD_FAILED", detail });
    return NextResponse.json({ status: "DOWNLOAD_FAILED", detail }, { status: 200 });
  }

  const result = await importPrices({ oilCsv: csvs.oil, lpgCsv: csvs.lpg });
  return NextResponse.json(result, { status: 200 });
}
