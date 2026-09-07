/**
 * 시설정보 백필 수동 실행 / 현황 확인 — docs/MIGRATION-DB.md §7 Phase E.
 *
 * 평소엔 Vercel Cron(/api/cron/backfill-details)이 매일 자동으로 돌립니다. 이 스크립트는
 * 로컬에서 진행 상황을 확인하거나, 크론이 며칠 밀렸을 때 따라잡기용입니다.
 * 서비스 로직(services/detail-backfill-service.ts)을 그대로 공유합니다.
 *
 * 사용법:
 *   pnpm data:backfill-details --status   # 진행 현황만 출력 (오피넷 호출 없음)
 *   pnpm data:backfill-details            # 기본 예산(OPINET_BACKFILL_LIMIT, 기본 280)
 *   pnpm data:backfill-details 50         # 이번 실행만 50건으로 제한
 *
 * 필요 환경변수: DATABASE_URL (--status), OPINET_CERT_KEY (실제 백필)
 */

import { backfillDetails } from "@/services/detail-backfill-service";
import { getDetailBackfillProgress } from "@/infra/db/repositories";
import { requireEnv, header, info, ok } from "./_shared";

function pct(done: number, total: number): string {
  return total === 0 ? "100%" : `${((done / total) * 100).toFixed(1)}%`;
}

async function main() {
  const arg = process.argv[2];

  if (arg === "--status" || arg === "-s") {
    requireEnv(["DATABASE_URL"]);
    header("시설정보 백필 현황");
    const p = await getDetailBackfillProgress();
    ok(`완료 ${p.done.toLocaleString()} / ${p.total.toLocaleString()} (${pct(p.done, p.total)})`);
    if (p.remaining === 0) {
      ok("남은 대상 없음 — 백필 완료 🎉 (result/page.tsx의 FacilityCoverageBanner 제거 가능)");
    } else {
      info(`남은 대상 ${p.remaining.toLocaleString()}건 — 하루 280건 기준 약 ${Math.ceil(p.remaining / 280)}일`);
    }
    return;
  }

  requireEnv(["OPINET_CERT_KEY", "DATABASE_URL"]);
  const limitArg = arg ? Number(arg) : undefined;
  if (limitArg !== undefined && (!Number.isFinite(limitArg) || limitArg <= 0)) {
    throw new Error(`limit 인자가 올바르지 않습니다: ${arg}`);
  }

  header(`시설정보 백필 ${limitArg ? `(이번 실행 ${limitArg}건)` : "(기본 예산)"}`);
  const r = await backfillDetails(limitArg ? { limit: limitArg } : {});

  ok(`꺼냄 ${r.picked} · 반영 ${r.updated} · 폐업추정 ${r.notFound} · 실패 ${r.failed}`);
  if (r.remaining > 0) {
    const days = Math.ceil(r.remaining / Math.max(r.limit, 1));
    info(`남은 대상 ${r.remaining.toLocaleString()}건 — 하루 ${r.limit}건 기준 약 ${days}일`);
  } else {
    ok("남은 대상 없음 — 백필 완료");
  }
}

main().catch((err: unknown) => {
  console.error("✖ 백필 실패:", err);
  process.exitCode = 1;
});
