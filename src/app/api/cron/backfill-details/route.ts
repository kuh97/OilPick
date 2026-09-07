/**
 * 시설정보 백필 크론 — docs/MIGRATION-DB.md §7 Phase E.
 *
 * Vercel Cron이 하루 1회 GET으로 부릅니다(vercel.json). 일일 유가 CSV 임포트
 * (/api/cron/import-prices)가 끝난 뒤에 돌도록 스케줄을 뒤에 둡니다 — 새로 들어온
 * 주유소가 이번 백필 큐에 바로 포함되도록.
 *
 * 큐(`detail_synced_at IS NULL`)가 비면 아무것도 하지 않고 200을 반환합니다.
 * 상세 API 호출 실패는 다음 실행에서 재시도되므로 5xx로 올리지 않습니다.
 */

import { NextResponse } from "next/server";
import { env } from "@/infra/env";
import { backfillDetails } from "@/services/detail-backfill-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Fluid Compute Hobby 상한 (§12)

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await backfillDetails();
  return NextResponse.json(result, { status: 200 });
}
