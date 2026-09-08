/**
 * verify:t3-rate — T3 발동률 · 게이트 통과율
 *
 * 노선 × 연료 조합별로 실제 검색 파이프라인과 같은 방법(회랑 bbox 수집 + P_ref +
 * T3 게이트)을 돌려 T1/T2/T3 분류와 T3 게이트 통과 결과를 집계합니다.
 *
 * ★ LPG T3 발동률이 20% 미만이면 개발을 멈추고 기획 재검토 대상입니다 (PRODUCT.md §11.3).
 *
 * 회랑 bbox가 T3_MAX까지 한 번에 덮으므로(§7 Phase C) "후보가 모자라 넓혀 찾는다"는
 * 옛 확장 단계(MIN_CANDIDATES 게이트·normalOffsets)가 없습니다 — 후보 수집은 조합당
 * 정확히 1번입니다. P_ref는 이제 시군구→시도→전국 폴백 체인이 전부 구현돼 있어
 * (price-service.ts, Phase 6) 실제 검색이 쓰는 것과 완전히 같은 함수를 그대로 씁니다 —
 * 예전 스크립트의 "Phase 6 이전이라 시군구 폴백 불가" 제약은 더 이상 없습니다.
 *
 * 실행: pnpm verify:t3-rate [--route=0,1,2,3|all] [--fuel=LPG|GASOLINE|DIESEL|all]
 * 기본: 노선 전체 × LPG만 (1순위 타깃, 가장 저렴한 조합).
 */

import { header, info, ok, warn, fail, requireEnv } from "../_shared";
import { ROUTES } from "./_routes";
import { parseFuelArg, parseRouteIndexArg } from "./_measure-shared";
import { fetchDirections } from "@/infra/kakao/mobility";
import { collectStations } from "@/services/station-service";
import { computeReferencePrice } from "@/services/price-service";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { classifyTier } from "@/domain/tier";
import { passesT3Gate } from "@/domain/pricing";
import { T3_MAX, DEFAULT_EFFICIENCY, DEFAULT_REFUEL_AMOUNT } from "@/domain/params";
import type { Fuel, ProjectedPoint, RefuelPoint, Tier } from "@/domain/types";

requireEnv(["KAKAO_REST_API_KEY", "DATABASE_URL"]);

const NO_FILTERS = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };

const routeIndexes = parseRouteIndexArg(ROUTES.length);
const fuels = parseFuelArg();

header("verify:t3-rate — 계획");
info(`대상: ${routeIndexes.map((i) => ROUTES[i].label).join(", ")} × ${fuels.join(", ")}`);
info(`카카오 호출 ${routeIndexes.length * fuels.length}회(조합당 기본 경로 1회). 후보 조회는 refuel_point DB 쿼리뿐입니다.`);

interface Classified {
  id: string;
  price: number;
  sigunCd?: string;
  dPerpM: number;
  tier: Tier | null;
}

function classify(
  stations: Array<{ station: RefuelPoint; price: number }>,
  routeProjected: ProjectedPoint[],
): Classified[] {
  return stations.map(({ station, price }) => {
    const dPerpM = pointToPolylineDistanceM(wgs84ToProjected(station.location), routeProjected);
    return { id: station.id, price, sigunCd: station.sigunCd, dPerpM, tier: classifyTier(dPerpM) };
  });
}

interface RunResult {
  route: string;
  fuel: Fuel;
  t1: number;
  t2: number;
  t3Candidates: number;
  t3AfterGate: number;
  refPrice: number | "없음";
}

const results: RunResult[] = [];

for (const idx of routeIndexes) {
  const route = ROUTES[idx];
  for (const fuel of fuels) {
    header(`[${idx}] ${route.label} × ${fuel}`);

    const baseRoute = await fetchDirections({ origin: route.origin, destination: route.destination, fuel, retries: 1 });
    const routeProjected = baseRoute.polyline.map(wgs84ToProjected);
    info(`실측 거리 ${(baseRoute.distanceM / 1000).toFixed(1)}km`);

    const collected = await collectStations({
      referencePoints: routeProjected,
      marginM: T3_MAX,
      fuel,
      filters: NO_FILTERS,
    });
    const classified = classify(collected.stations, routeProjected).filter((c) => c.tier != null);

    const t1 = classified.filter((c) => c.tier === "T1").length;
    const t2 = classified.filter((c) => c.tier === "T2").length;
    const t3Candidates = classified.filter((c) => c.tier === "T3");

    const t1t2Prices = classified.filter((c) => c.tier === "T1" || c.tier === "T2").map((c) => c.price);
    const refResult = await computeReferencePrice({
      t1t2Prices,
      pool: classified.map((c) => ({ sigunCd: c.sigunCd })),
      fuel,
    });

    let t3AfterGate = 0;
    if (refResult) {
      const efficiency = DEFAULT_EFFICIENCY[fuel];
      for (const c of t3Candidates) {
        const passes = passesT3Gate({
          priceRefWon: refResult.price,
          priceStationWon: c.price,
          refuelAmountL: DEFAULT_REFUEL_AMOUNT,
          dPerpM: c.dPerpM,
          efficiencyKmPerL: efficiency,
        });
        if (passes) t3AfterGate++;
      }
    } else {
      warn("P_ref를 산출할 수 없습니다(A14) — T3 게이트 판정 불가.");
    }

    info(`T1=${t1} T2=${t2} T3후보=${t3Candidates.length} T3(게이트 통과)=${t3AfterGate} P_ref=${refResult?.price ?? "없음"}`);
    results.push({
      route: route.label,
      fuel,
      t1,
      t2,
      t3Candidates: t3Candidates.length,
      t3AfterGate,
      refPrice: refResult?.price ?? "없음",
    });
  }
}

// ─── 집계 ────────────────────────────────────────────────────────────────────
header("집계");
console.table(results);

const lpgResults = results.filter((r) => r.fuel === "LPG");
if (lpgResults.length > 0) {
  const triggeredCount = lpgResults.filter((r) => r.t3AfterGate > 0).length;
  const triggerRate = triggeredCount / lpgResults.length;
  info(`LPG T3 발동률: ${(triggerRate * 100).toFixed(0)}% (${triggeredCount}/${lpgResults.length})`);

  if (triggerRate < 0.2) {
    fail("LPG T3 발동률이 20% 미만입니다 — PRODUCT.md §11.3에 따라 개발을 멈추고 기획을 재검토해야 합니다.");
    process.exit(1);
  }
  ok("LPG T3 발동률이 20% 이상입니다.");
} else {
  warn("LPG 조합이 선택되지 않아 발동률 게이트를 평가할 수 없습니다. --fuel=LPG 또는 --fuel=all로 다시 실행하십시오.");
}

console.log("\n── 다음 단계 ──────────────────────────────────────────");
info("파라미터를 바꿨다면 params.ts와 PRODUCT.md §9.1을 같은 커밋에서 갱신하십시오 (AGENTS.md §7.2).");
process.exit(0);
