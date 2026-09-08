/**
 * verify:uturn — 경로 API의 유턴·중앙분리대 반영 여부, DETOUR_ESTIMATE_FACTOR 보정 [§12 ④]
 *
 * 실제 후보 주유소 몇 곳을 경유지로 넣어 카카오 길찾기를 호출하고,
 * 실측 우회 거리(ΔD)를 추정식(ΔD̂ = DETOUR_ESTIMATE_FACTOR × d_perp)과 비교합니다.
 * 비율이 큰 이상치가 있으면 유턴·중앙분리대·IC 진출입 때문일 가능성이 높습니다
 * (PRODUCT.md §6.5 표 참고).
 *
 * 후보는 오피넷 반경검색이 아니라 실제 검색 파이프라인과 같은 방법(station-service.
 * collectStations — refuel_point 회랑 bbox 쿼리)으로 모읍니다(MIGRATION-DB.md §7 Phase C
 * 전환 이후 이 스크립트는 오피넷을 전혀 호출하지 않습니다). LPG처럼 희소한 연료는
 * 이 노선에 후보가 아예 없을 수 있습니다 — 그 자체가 PRODUCT.md §1.4의 "LPG는 희소하다"는
 * 전제를 실측으로 보여주는 결과입니다.
 *
 * 실행: pnpm verify:uturn [--route=0|1|2|3] [--fuel=LPG|GASOLINE|DIESEL]
 * 기본: route 0 (성남→춘천) × LPG.
 */

import { header, info, ok, warn, requireEnv } from "../_shared";
import { ROUTES } from "./_routes";
import { parseFuelArg } from "./_measure-shared";
import { fetchDirections } from "@/infra/kakao/mobility";
import { collectStations } from "@/services/station-service";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { classifyTier } from "@/domain/tier";
import { estimateDetourDistanceM } from "@/domain/pricing";
import { T3_MAX, DETOUR_ESTIMATE_FACTOR } from "@/domain/params";

requireEnv(["KAKAO_REST_API_KEY", "DATABASE_URL"]);

const MAX_CANDIDATES = 6;
const NO_FILTERS = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };

const routeArg = process.argv.slice(2).find((a) => a.startsWith("--route="));
const routeIdx = routeArg ? Number(routeArg.split("=")[1]) : 0;
const route = ROUTES[routeIdx];
if (!route) throw new Error(`잘못된 --route 값: ${routeArg}`);
const [fuel] = parseFuelArg();

header("verify:uturn — 계획");
info(`대상 노선: ${route.label} × ${fuel}`);
info(`카카오 호출 최대 ${1 + MAX_CANDIDATES}회 (기본 경로 1 + 경유 경로 최대 ${MAX_CANDIDATES}) — 쿼터 내 무시할 수준.`);

const baseRoute = await fetchDirections({ origin: route.origin, destination: route.destination, fuel, retries: 1 });
info(`기본 경로 실측: ${(baseRoute.distanceM / 1000).toFixed(1)}km / ${Math.round(baseRoute.durationS / 60)}분`);

const polyline = baseRoute.polyline.map(wgs84ToProjected);
const collected = await collectStations({ referencePoints: polyline, marginM: T3_MAX, fuel, filters: NO_FILTERS });
info(`회랑 bbox 후보 ${collected.stations.length}곳`);

const withDPerp = collected.stations
  .map(({ station }) => ({ station, dPerpM: pointToPolylineDistanceM(wgs84ToProjected(station.location), polyline) }))
  .filter((s) => classifyTier(s.dPerpM) != null)
  .sort((a, b) => a.dPerpM - b.dPerpM);

if (withDPerp.length === 0) {
  warn(`이 노선에서 ${fuel} 후보를 찾지 못했습니다.`);
  warn("이 자체가 유의미한 결과입니다 — PRODUCT.md §1.4가 말하는 'LPG는 희소하다'를 실측으로 보여줍니다.");
  warn("다른 --route 또는 --fuel로 다시 시도하십시오.");
  process.exit(1);
}

// d_perp 분포를 고르게 커버하도록 등간격으로 선택
const step = Math.max(1, Math.floor(withDPerp.length / MAX_CANDIDATES));
const selected = withDPerp.filter((_, i) => i % step === 0).slice(0, MAX_CANDIDATES);

interface Row {
  name: string;
  dPerpM: number;
  estimatedDetourM: number;
  actualDetourM: number;
  ratio: number;
}

const rows: Row[] = [];

for (const { station, dPerpM } of selected) {
  const viaRoute = await fetchDirections({
    origin: route.origin,
    destination: route.destination,
    waypoint: station.location,
    fuel,
    retries: 0, // 경유 경로 — ARCHITECTURE.md §5.4
  });
  const actualDetourM = Math.max(0, viaRoute.distanceM - baseRoute.distanceM); // AGENTS.md §5 불변식 5
  const estimatedDetourM = estimateDetourDistanceM(dPerpM);
  const ratio = dPerpM > 0 ? actualDetourM / dPerpM : NaN;
  rows.push({
    name: station.name,
    dPerpM: Math.round(dPerpM),
    estimatedDetourM: Math.round(estimatedDetourM),
    actualDetourM,
    ratio: Number(ratio.toFixed(2)),
  });
}

header("결과 — d_perp 대비 실제 우회거리 비율 (ΔD / d_perp)");
console.table(rows);

function medianOf(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const validRatios = rows.map((r) => r.ratio).filter((r) => Number.isFinite(r));
const medianRatio = medianOf(validRatios);
const maxRatio = Math.max(...validRatios);
// 평균은 극단치 하나에 쉽게 흔들려서(예: 유턴 필요 케이스) 보정 기준으로 쓰지 않습니다 — 중앙값을 씁니다.
const outliers = rows.filter((r) => Number.isFinite(r.ratio) && r.ratio > medianRatio * 3);

info(`현재 DETOUR_ESTIMATE_FACTOR = ${DETOUR_ESTIMATE_FACTOR}`);
info(`실측 비율 중앙값 = ${medianRatio.toFixed(2)}, 최댓값 = ${maxRatio.toFixed(2)}`);

if (outliers.length > 0) {
  warn(`중앙값의 3배를 넘는 이상치 ${outliers.length}곳: ${outliers.map((o) => `${o.name}(${o.ratio}배)`).join(", ")}`);
  warn(
    "유턴·중앙분리대·IC 진출입 영향으로 추정됩니다 (PRODUCT.md §6.5) — 이런 후보는 추정식만으로는 못 잡아내므로, 정밀 계산(경유 경로 실측) 전까지 확정 수치로 쓰면 안 됩니다. 이미 그렇게 구현되어 있습니다 (detour.precise).",
  );
} else {
  ok("이상치 없이 고르게 분포합니다.");
}

console.log("\n── 다음 단계 ──────────────────────────────────────────");
info(`DETOUR_ESTIMATE_FACTOR를 ${medianRatio.toFixed(1)}로 보정할지 검토하십시오 (현재 ${DETOUR_ESTIMATE_FACTOR}). 이상치는 중앙값 계산에서 제외됩니다.`);
info("표본이 적으므로(최대 6곳) 다른 노선(--route=1, --route=2)·연료에서도 돌려 중앙값을 교차 확인하십시오.");
info("값을 바꾸면 params.ts와 PRODUCT.md §9.1을 같은 커밋에서 갱신하십시오 (AGENTS.md §7.2).");
