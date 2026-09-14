/**
 * 익명 이벤트 성공 지표 — PRODUCT.md §11.1, ARCHITECTURE.md §7.3.
 * 운영 대시보드나 일회성 점검에서 호출하는 읽기 전용 쿼리입니다.
 */

import { countDistinct, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { naviClickEvent, searchEvent } from "./schema";

export interface SuccessMetrics {
  t3TriggerRate: number;
  naviClickRate: {
    withT3: number;
    withoutT3: number;
  };
}

export async function getSuccessMetrics(db: Db = getDb()): Promise<SuccessMetrics> {
  const [t3Row] = await db
    .select({
      rate: sql<number>`COALESCE(AVG(CASE WHEN ${searchEvent.t3Count} > 0 THEN 1.0 ELSE 0.0 END), 0)`,
    })
    .from(searchEvent);

  const hasT3 = sql<boolean>`${searchEvent.t3Count} > 0`;
  const rows = await db
    .select({
      hasT3,
      clickRate: sql<number>`COALESCE(${countDistinct(naviClickEvent.searchId)}::float / NULLIF(${countDistinct(searchEvent.id)}, 0), 0)`,
    })
    .from(searchEvent)
    .leftJoin(naviClickEvent, eq(naviClickEvent.searchId, searchEvent.id))
    .groupBy(hasT3);

  return {
    t3TriggerRate: Number(t3Row?.rate ?? 0),
    naviClickRate: {
      withT3: Number(rows.find((row) => row.hasT3)?.clickRate ?? 0),
      withoutT3: Number(rows.find((row) => !row.hasT3)?.clickRate ?? 0),
    },
  };
}
