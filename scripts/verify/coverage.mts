/**
 * verify:coverage — 회랑 bbox 수집이 후보를 누락하지 않는지 검증 [§12 ⑫]
 *
 * ⑫는 이미 "해결됨"으로 표시되어 있습니다(ARCHITECTURE.md §12) — 회랑 bbox 쿼리가
 * T1~T3를 한 번에 덮으므로 "샘플 간격이 후보를 놓친다"는 옛 질문 자체가 지금 코드에
 * 성립하지 않습니다. 이 스크립트가 예전에 비교하던 두 표본(성긴 SAMPLE_INTERVAL vs
 * 촘촘한 DENSE_INTERVAL_M)은 더 이상 존재하지 않습니다(MIGRATION-DB.md §7 Phase C·§10).
 *
 * 그래서 검증 대상을 옮깁니다: "덜 촘촘한 샘플링"이 아니라 "station-service의 bbox
 * 계산(§7 Phase C)이 버그로 후보를 놓치는가"가 지금의 실제 위험입니다 — 사각형 네
 * 꼭짓점을 역투영해 min/max를 잡는 방식이라(station-service.ts computeBbox 주석),
 * 좌표계 실수 하나면(AGENTS.md "좌표계 혼동이 이 프로젝트의 1순위 버그 원천") 조용히
 * 후보가 사라질 수 있습니다.
 *
 * 방법: 전국을 덮는 bbox로 refuel_point를 통째로 읽어(findRefuelPointsInBbox, "정답")
 * 각 행의 d_perp·티어를 직접 계산한 뒤, 실제 검색 경로가 쓰는 collectStations()
 * (회랑 bbox)의 결과와 비교합니다. 회랑 bbox는 원래 실제 회랑보다 넓게 잡히도록
 * 설계되어(station-service.ts 주석 — "후보를 놓치는 대신 더 주는 쪽으로 안전하게
 * 설계") 항상 정답의 상위집합이어야 하므로, 정답에는 있는데 bbox 결과에 없는 후보가
 * 1건이라도 있으면 그 자체가 버그입니다 — 허용 오차 없이 0건이어야 합니다.
 *
 * 실행: pnpm verify:coverage [--route=0,1,2,3|all] [--fuel=LPG|GASOLINE|DIESEL|all]
 * 기본: 노선 전체 × LPG (1순위 타깃).
 */

import { header, info, ok, warn, summary, requireEnv } from "../_shared";
import { ROUTES } from "./_routes";
import { parseFuelArg, parseRouteIndexArg } from "./_measure-shared";
import { fetchDirections } from "@/infra/kakao/mobility";
import { collectStations } from "@/services/station-service";
import { findRefuelPointsInBbox } from "@/infra/db/repositories";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { classifyTier } from "@/domain/tier";
import { T3_MAX } from "@/domain/params";
import type { ProjectedPoint, RefuelPoint } from "@/domain/types";

requireEnv(["KAKAO_REST_API_KEY", "DATABASE_URL"]);

// 대한민국 전역을 넉넉히 덮는 bbox — "정답"(전수 스캔) 산출용. 정확한 국경일 필요는
// 없고, 마스터에 있는 모든 refuel_point를 담기만 하면 된다(§7 Phase C 전국 커버리지).
const NATIONWIDE_BBOX = { minLat: 32.5, maxLat: 39.0, minLng: 124.0, maxLng: 132.0 };
const NO_FILTERS = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };

const routeIndexes = parseRouteIndexArg(ROUTES.length);
const fuels = parseFuelArg();

header("verify:coverage — 회랑 bbox 누락 검사");
info(`대상: ${routeIndexes.map((i) => ROUTES[i].label).join(", ")} × ${fuels.join(", ")}`);
info(`카카오 호출 ${routeIndexes.length * fuels.length}회(조합당 기본 경로 1회). 나머지는 DB 조회뿐입니다.`);

interface Row {
  id: string;
  dPerp: number;
  tier: string;
}

function classify(stations: Array<{ station: RefuelPoint }>, polyline: ProjectedPoint[]): Row[] {
  const rows: Row[] = [];
  for (const { station } of stations) {
    const dPerp = pointToPolylineDistanceM(wgs84ToProjected(station.location), polyline);
    const tier = classifyTier(dPerp);
    if (tier) rows.push({ id: station.id, dPerp, tier });
  }
  return rows;
}

const passed: string[] = [];
const failed: string[] = [];

for (const idx of routeIndexes) {
  const route = ROUTES[idx];
  for (const fuel of fuels) {
    header(`[${idx}] ${route.label} × ${fuel}`);
    info(route.note);

    const baseRoute = await fetchDirections({ origin: route.origin, destination: route.destination, fuel, retries: 1 });
    const polyline = baseRoute.polyline.map(wgs84ToProjected);
    info(`실측 거리 ${(baseRoute.distanceM / 1000).toFixed(1)}km`);

    const now = new Date();
    const [truthRows, bboxed] = await Promise.all([
      findRefuelPointsInBbox(NATIONWIDE_BBOX, fuel, now).then((rows) => classify(rows, polyline)),
      collectStations({ referencePoints: polyline, marginM: T3_MAX, fuel, filters: NO_FILTERS, now }).then((r) =>
        classify(r.stations, polyline),
      ),
    ]);

    const bboxedIds = new Set(bboxed.map((r) => r.id));
    const missing = truthRows.filter((r) => !bboxedIds.has(r.id));

    info(`전수 스캔 후보(T1~T3) ${truthRows.length}곳 / 회랑 bbox 후보 ${bboxed.length}곳`);

    const label = `${route.label} × ${fuel}`;
    if (missing.length === 0) {
      ok(`${label}: 누락 0건 — 회랑 bbox가 전수 스캔의 상위집합입니다.`);
      passed.push(label);
    } else {
      warn(`${label}: ${missing.length}건 누락 — station-service.computeBbox 또는 좌표 변환을 의심하십시오.`);
      missing.slice(0, 5).forEach((m) => warn(`  누락: id=${m.id} tier=${m.tier} d_perp=${m.dPerp.toFixed(0)}m`));
      failed.push(label);
    }
  }
}

const allPassed = summary(passed, failed);
console.log("\n── 다음 단계 ──────────────────────────────────────────");
if (allPassed) {
  info("bbox 수집이 전수 스캔과 일치합니다. §12 ⑫는 계속 '해결됨'입니다.");
} else {
  warn("station-service.ts의 computeBbox 역투영 로직 또는 findRefuelPointsInBbox의 경계 조건을 점검하십시오.");
}
process.exit(allPassed ? 0 : 1);
