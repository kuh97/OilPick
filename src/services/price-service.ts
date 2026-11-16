/**
 * P_ref(기준가) 산출 — STEP 7.
 * ARCHITECTURE.md §7.2 STEP 7, PRODUCT.md §8 "시군구 가중평균".
 *
 * domain/pricing.computeReferencePrice는 숫자 하나(폴백값)만 받으므로,
 * 시군구별 가중평균 계산은 이 파일이 맡습니다.
 */

import { computeReferencePrice as domainComputeReferencePrice } from "@/domain/pricing";
import {
  findSigunguAvgPrice,
  findSidoAvgPrice,
  findNationalAvgPrice,
} from "@/infra/db/repositories";
import { getDb, type Db } from "@/infra/db/client";
import type { Fuel, RefPriceSource } from "@/domain/types";

export interface ComputeReferencePriceOptions {
  /** MEDIAN_T1T2 후보 가격 (d_perp ≤ T2_MAX, 필터 적용 후; 이름은 API 계약) */
  t1t2Prices: number[];
  /** 필터 적용 후 회랑 전체 후보 — 시군구 가중평균 계산용 */
  pool: Array<{ sigunCd?: string }>;
  fuel: Fuel;
  db?: Db;
  findSigunguAvgPrice?: typeof findSigunguAvgPrice;
  findSidoAvgPrice?: typeof findSidoAvgPrice;
  findNationalAvgPrice?: typeof findNationalAvgPrice;
}

/**
 * 시군구별 후보 수를 가중치로 한 평균가.
 * 시군구 → 시도 → 전국 순으로 폴백해 그룹마다 값을 하나 확보한 뒤 가중평균합니다
 * (PRODUCT.md §8). 값을 하나도 못 구하면 undefined.
 */
async function weightedSigunguAvg(
  pool: Array<{ sigunCd?: string }>,
  fuel: Fuel,
  db: Db,
  findSigungu: typeof findSigunguAvgPrice,
  findSido: typeof findSidoAvgPrice,
  findNational: typeof findNationalAvgPrice,
): Promise<number | undefined> {
  const counts = new Map<string, number>();
  for (const c of pool) {
    if (!c.sigunCd) continue;
    counts.set(c.sigunCd, (counts.get(c.sigunCd) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [sigunCd, weight] of counts) {
    const avg =
      (await findSigungu(sigunCd, fuel, db)) ??
      (await findSido(sigunCd.slice(0, 2), fuel, db)) ??
      (await findNational(fuel, db));
    if (avg == null) continue;
    weightedSum += avg * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return undefined;
  return Math.round(weightedSum / totalWeight);
}

export async function computeReferencePrice(
  opts: ComputeReferencePriceOptions,
): Promise<{ price: number; source: RefPriceSource } | null> {
  const db = opts.db ?? getDb();
  const findSigungu = opts.findSigunguAvgPrice ?? findSigunguAvgPrice;
  const findSido = opts.findSidoAvgPrice ?? findSidoAvgPrice;
  const findNational = opts.findNationalAvgPrice ?? findNationalAvgPrice;

  const sigunguAvg = await weightedSigunguAvg(opts.pool, opts.fuel, db, findSigungu, findSido, findNational);
  return domainComputeReferencePrice(opts.t1t2Prices, sigunguAvg);
}
