/**
 * verify:t3-rate — 현재 회랑 후보·기준가(P_ref) 점검
 *
 * 예전에는 존재하지 않는 T1/T2/T3 분류 함수와 삭제된 가격 게이트를 호출했습니다.
 * 현재 제품은 d_perp로 후보를 자르는 대신, Valhalla의 실제 ΔT·ΔD로 경로상/우회를
 * 판정합니다. 그 전체 검색을 이 작은 스크립트에서 흉내 내면 운영 검색과 다른 결과를
 * 만들 수 있으므로, 지금은 운영 검색에 들어가기 전의 회랑 후보와 기준가 표본을
 * 점검하는 용도로 이름을 유지합니다. 최종 배지는 recommendation-service가 정합니다.
 *
 * 실행: pnpm verify:t3-rate [--route=0,1,2,3|all] [--fuel=LPG|GASOLINE|DIESEL|all]
 * 기본: 노선 전체 × LPG만 (가격 표본이 부족하기 쉬운 조합을 우선 확인).
 */

import { header, info, ok, warn, requireEnv } from "../_shared";
import { ROUTES } from "./_routes";
import { parseFuelArg, parseRouteIndexArg } from "./_measure-shared";
import { fetchDirections } from "@/infra/kakao/mobility";
import { collectStations } from "@/services/station-service";
import { computeReferencePrice } from "@/services/price-service";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { ON_ROUTE_PREFILTER_MAX_M, T2_MAX, T3_MAX } from "@/domain/params";
import type { Fuel, ProjectedPoint, RefuelPoint } from "@/domain/types";

requireEnv(["KAKAO_REST_API_KEY", "DATABASE_URL"]);

const NO_FILTERS = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };
const routeIndexes = parseRouteIndexArg(ROUTES.length);
const fuels = parseFuelArg();

header("verify:t3-rate — 회랑 후보·기준가 점검");
info(`대상: ${routeIndexes.map((i) => ROUTES[i].label).join(", ")} × ${fuels.join(", ")}`);
info(`카카오 호출 ${routeIndexes.length * fuels.length}회(조합당 기본 경로 1회). 후보 조회는 refuel_point DB 쿼리입니다.`);

interface Classified {
  id: string;
  price: number;
  sigunCd?: string;
  dPerpM: number;
}

function classify(
  stations: Array<{ station: RefuelPoint; price: number }>,
  routeProjected: ProjectedPoint[],
): Classified[] {
  return stations
    .map(({ station, price }) => ({
      id: station.id,
      price,
      sigunCd: station.sigunCd,
      dPerpM: pointToPolylineDistanceM(wgs84ToProjected(station.location), routeProjected),
    }))
    .filter((candidate) => candidate.dPerpM <= T3_MAX);
}

interface RunResult {
  route: string;
  fuel: Fuel;
  stage1: number;
  referenceSample: number;
  corridor: number;
  referencePrice: number | "없음";
  referenceSource: string | "없음";
}

const results: RunResult[] = [];

for (const idx of routeIndexes) {
  const route = ROUTES[idx];
  for (const fuel of fuels) {
    header(`[${idx}] ${route.label} × ${fuel}`);

    const baseRoute = await fetchDirections({ origin: route.origin, destination: route.destination, fuel, retries: 1 });
    const routeProjected = baseRoute.polyline.map(wgs84ToProjected);
    info(`기본 경로 ${(baseRoute.distanceM / 1000).toFixed(1)}km`);

    const collected = await collectStations({
      referencePoints: routeProjected,
      marginM: T3_MAX,
      fuel,
      filters: NO_FILTERS,
    });
    const classified = classify(collected.stations, routeProjected);
    const stage1 = classified.filter((candidate) => candidate.dPerpM <= ON_ROUTE_PREFILTER_MAX_M).length;
    const reference = classified.filter((candidate) => candidate.dPerpM <= T2_MAX);
    const referenceResult = await computeReferencePrice({
      t1t2Prices: reference.map((candidate) => candidate.price),
      pool: classified.map((candidate) => ({ sigunCd: candidate.sigunCd })),
      fuel,
    });

    info(
      `STAGE 1(300m 사전 범위)=${stage1}곳 / P_ref 표본(3km)=${reference.length}곳 / ` +
        `회랑(15km)=${classified.length}곳 / P_ref=${referenceResult?.price ?? "없음"}`,
    );
    if (!referenceResult) warn("기준가를 계산할 수 없습니다(A14). 운영 검색은 절감액 대신 가격순으로 처리합니다.");

    results.push({
      route: route.label,
      fuel,
      stage1,
      referenceSample: reference.length,
      corridor: classified.length,
      referencePrice: referenceResult?.price ?? "없음",
      referenceSource: referenceResult?.source ?? "없음",
    });
  }
}

header("집계");
console.table(results);
const hasUsableData = results.some((result) => result.corridor > 0);
if (hasUsableData) {
  ok("현재 회랑 후보와 기준가 표본을 확인했습니다. 최종 경로상/우회 배지는 실제 ΔT·ΔD 측정 결과를 사용합니다.");
} else {
  warn("회랑 후보가 없습니다. DB의 refuel_point 임포트일자·좌표·연료 가격을 확인하십시오.");
}

process.exit(hasUsableData ? 0 : 1);
