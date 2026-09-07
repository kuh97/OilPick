/**
 * 시설정보 백필 오케스트레이터 — docs/MIGRATION-DB.md §7 Phase E.
 *
 *   큐 조회(detail_synced_at IS NULL) → 상세 API 병렬 호출 → 시설 컬럼만 UPDATE
 *     → 상세 API에 없는 건 "확인함"으로만 표시 → 남은 건수 집계
 *
 * 검색 경로가 오피넷을 쓰지 않으므로(§7 Phase C) 일일 예산(기본 280회)을 전부 여기
 * 씁니다. 큐가 비면 저절로 멈추고, 이후엔 CSV가 발견한 신규 주유소만 하루 1~2건
 * 처리합니다. 상세 API가 소유한 컬럼만 건드리므로(§6) 매일 도는 CSV 임포트와
 * 충돌하지 않습니다.
 *
 * 이 함수는 Vercel Cron 라우트와 `pnpm data:backfill-details` 스크립트가 **공유**합니다.
 * 로직을 복제하지 마십시오(ARCHITECTURE.md §9.3).
 */

import { createSemaphore, fetchDetail } from "@/infra/opinet/client";
import { mapDetailItem } from "@/infra/opinet/mapper";
import { getDb, type Db } from "@/infra/db/client";
import { env } from "@/infra/env";
import {
  findStationsNeedingDetailBackfill,
  countStationsNeedingDetailBackfill,
  updateDetailFields,
  markDetailSyncedEmpty,
} from "@/infra/db/repositories";

/** 상세 API 동시 호출 수 — 오피넷 클라이언트 세마포어와 별개로 이 배치만의 상한. */
const CONCURRENCY = 8;

export interface DetailBackfillDeps {
  db?: Db;
  /** 상세 API 호출 주입 (테스트용). 기본은 오피넷 실호출 */
  fetchDetail?: typeof fetchDetail;
  now?: Date;
}

export interface DetailBackfillResult {
  /** 이번 실행에 허용된 처리량 (env.OPINET_BACKFILL_LIMIT 또는 인자) */
  limit: number;
  /** 큐에서 꺼낸 대상 수 */
  picked: number;
  /** 시설정보를 반영한 수 */
  updated: number;
  /** 상세 API에 없어 "확인함"으로만 표시한 수 (폐업 추정) */
  notFound: number;
  /** 호출 실패 — 이번엔 건너뛰고 다음 실행에서 재시도 */
  failed: number;
  /** 아직 detail_synced_at IS NULL인 남은 대상 수 */
  remaining: number;
}

export async function backfillDetails(
  opts: { limit?: number } = {},
  deps: DetailBackfillDeps = {},
): Promise<DetailBackfillResult> {
  const db = deps.db ?? getDb();
  const fetch = deps.fetchDetail ?? fetchDetail;
  const now = deps.now ?? new Date();
  const limit = opts.limit ?? env.OPINET_BACKFILL_LIMIT;

  const ids = await findStationsNeedingDetailBackfill(limit, db);
  if (ids.length === 0) {
    return { limit, picked: 0, updated: 0, notFound: 0, failed: 0, remaining: 0 };
  }

  const notFoundIds: string[] = [];
  let updated = 0;
  let failed = 0;

  const semaphore = createSemaphore(CONCURRENCY);
  await Promise.all(
    ids.map((id) =>
      semaphore.run(async () => {
        let item;
        try {
          item = await fetch({ uniId: id });
        } catch {
          failed++;
          return;
        }
        if (!item) {
          notFoundIds.push(id);
          return;
        }
        const mapped = mapDetailItem(item);
        await updateDetailFields(
          {
            id, // 큐의 id를 정본으로 — 응답 UNI_ID가 달라도 이 행을 갱신
            hasCarWash: mapped.facilities.carWash,
            hasMaintenance: mapped.facilities.maintenance,
            hasCvs: mapped.facilities.cvs,
            isKpetro: mapped.isKpetro,
            tel: mapped.tel ?? null,
          },
          db,
          now,
        );
        updated++;
      }),
    ),
  );

  const notFound = await markDetailSyncedEmpty(notFoundIds, db, now);
  const remaining = await countStationsNeedingDetailBackfill(db);

  return { limit, picked: ids.length, updated, notFound, failed, remaining };
}
