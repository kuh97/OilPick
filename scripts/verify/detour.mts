/**
 * verify:detour (⑭) — 실제 우회 거리·시간 분포 측정.
 *
 * `docs/ARCHITECTURE.md` §12 ⑭ · `docs/PRODUCT.md` §11.3.
 * `DETOUR_TIME_CAP_RATIO`와 "ΔD 단독 판정 폐기(§6.5 ΔD_eff)"의 근거가 노선 1개뿐이라,
 * 노선·연료를 바꿔가며 이 스크립트를 돌려 표본을 늘려야 합니다.
 *
 *   pnpm verify:detour "출발지" "목적지" [GASOLINE|DIESEL|LPG] [샘플수]
 *
 * 검색 파이프라인 STAGE 2와 같은 검색 반경(선택 거리+3km, 최대 15km)으로 후보를 만든 뒤,
 * 후보에 대해 경유 경로를 실제로 호출해 ΔD·ΔT를 잽니다. 경로 캐시(1시간)를 그대로 타므로
 * 같은 노선을 반복해도 카카오 호출이 늘지 않습니다.
 */

import { searchPlaces } from "@/services/place-service";
import { getRoute } from "@/services/route-service";
import { collectStations } from "@/services/station-service";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import { isOutOfRange, detourSearchRadiusM } from "@/domain/tier";
import { exceedsDetourCap } from "@/domain/pricing";
import {
  T3_MAX,
  AVG_SPEED,
  DETOUR_TIME_CAP_RATIO,
  DEFAULT_MAX_DETOUR_DISTANCE_KM,
} from "@/domain/params";
import { header, info, warn } from "../_shared";
import type { Fuel, WGS84Point } from "@/domain/types";

const CONCURRENCY = 10;

/** _shared의 fail()은 출력만 하므로, 계속 진행하면 안 되는 곳에서는 이걸 씁니다. */
function abort(msg: string): never {
  warn(msg);
  process.exit(1);
}

/** 소제목 — _shared의 header()는 최상단 1회용이라 구분선이 과합니다. */
function section(title: string): void {
  console.log(`\n${title}`);
}

const [originQ, destQ, fuelArg, sampleArg] = process.argv.slice(2);
if (!originQ || !destQ) {
  abort('사용법: pnpm verify:detour "출발지" "목적지" [GASOLINE|DIESEL|LPG] [샘플수]');
}
const fuel = (fuelArg ?? "GASOLINE") as Fuel;
const sampleSize = Number(sampleArg ?? 40);

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

header(`verify:detour — 추정 vs 실측 우회 (${fuel})`);

const [origin] = await searchPlaces({ query: originQ });
const [destination] = await searchPlaces({ query: destQ });
if (!origin || !destination) abort("출발지 또는 목적지를 찾지 못했습니다.");

const base = await getRoute({ origin: origin.location, destination: destination.location, fuel });
const polyline = base.polyline.map(wgs84ToProjected);
console.log(`출발  ${origin.name} (${origin.address})`);
console.log(`도착  ${destination.name} (${destination.address})`);
console.log(`기본경로  ${(base.distanceM / 1000).toFixed(1)}km / ${(base.durationS / 60).toFixed(0)}분`);

const searchRadiusM = detourSearchRadiusM(DEFAULT_MAX_DETOUR_DISTANCE_KM * 1000);

const collected = await collectStations({
  referencePoints: polyline,
  marginM: searchRadiusM,
  fuel,
  filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
});

interface Cand {
  name: string;
  price: number;
  dPerp: number;
  sigunCd?: string;
  location: WGS84Point;
}
const pool: Cand[] = [];
for (const { station, price } of collected.stations) {
  const dPerp = pointToPolylineDistanceM(wgs84ToProjected(station.location), polyline);
  if (isOutOfRange(dPerp) || dPerp > searchRadiusM) continue;
  pool.push({ name: station.name, price, dPerp, sigunCd: station.sigunCd, location: station.location });
}

info(`후보 수집 ${collected.stations.length} → 실제 측정 범위 ${pool.length} (검색 반경 ${searchRadiusM / 1000}km)`);

// 후보를 직선거리 순으로 고르게 뽑되, 통과 여부는 아래 실제 경로 결과로만 판단한다.
const targets = [...pool].sort((a, b) => a.dPerp - b.dPerp).slice(0, sampleSize);

section(`실측 (${targets.length}개, 경유 경로 호출)`);
interface Row { c: Cand; dd: number; dt: number }
const rows: Row[] = [];
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const chunk = targets.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(
    chunk.map((t) =>
      getRoute({
        origin: origin.location,
        destination: destination.location,
        waypoint: t.c.location,
        fuel,
        retries: 0,
      }),
    ),
  );
  results.forEach((r, k) => {
    if (r.status !== "fulfilled") return; // A8 — 그 후보만 빠짐
    rows.push({
      c: chunk[k],
      dd: Math.max(0, r.value.distanceM - base.distanceM),
      dt: Math.max(0, r.value.durationS - base.durationS),
    });
  });
  process.stdout.write(".");
}
console.log(` ${rows.length}/${targets.length}건 성공`);

const dts = rows.map((r) => r.dt / 60).sort((a, b) => a - b);
const dds = rows.map((r) => r.dd).sort((a, b) => a - b);

section("실측 ΔT 분포 (분)");
console.log(
  `min ${dts[0]?.toFixed(1)} · p25 ${quantile(dts, 0.25).toFixed(1)} · 중앙값 ${quantile(dts, 0.5).toFixed(1)} · p75 ${quantile(dts, 0.75).toFixed(1)} · max ${dts.at(-1)?.toFixed(1)}`,
);
console.log(`ΔD = 0 비율  ${((dds.filter((d) => d === 0).length / dds.length) * 100).toFixed(0)}%  ← 거리만 보면 "우회 없음"인데 시간은 늘어난 후보`);
console.log(`ΔT = 0 비율  ${((dts.filter((t) => t === 0).length / dts.length) * 100).toFixed(0)}%`);

section("d_perp 구간별 — 실측 ΔT 중앙값 (분)");
for (const [lo, hi] of [[0, 200], [200, 500], [500, 1_000], [1_000, 3_000], [3_000, T3_MAX]] as const) {
  const g = rows.filter((r) => r.c.dPerp >= lo && r.c.dPerp < hi);
  if (g.length === 0) continue;
  const real = g.map((r) => r.dt / 60).sort((a, b) => a - b);
  console.log(
    `  ${String(lo).padStart(6)}~${String(hi).padStart(6)}m  n=${String(g.length).padStart(3)}  실측 ${quantile(real, 0.5).toFixed(1)}분`,
  );
}

section("A6 시간 cap 판정");
const capped = rows.filter((r) =>
  exceedsDetourCap({
    detourDistanceM: r.dd,
    detourDurationS: r.dt,
    baseDistanceM: base.distanceM,
    baseDurationS: base.durationS,
  }),
);
console.log(`T_base × DETOUR_TIME_CAP_RATIO(${DETOUR_TIME_CAP_RATIO}) = ${((base.durationS * DETOUR_TIME_CAP_RATIO) / 60).toFixed(0)}분`);
console.log(`cap에 걸린 후보  ${capped.length}/${rows.length}`);
for (const r of capped.slice(0, 10)) {
  console.log(`  ❌ ${r.c.name} — d_perp ${r.c.dPerp.toFixed(0)}m · ΔD ${(r.dd / 1000).toFixed(1)}km · ΔT ${(r.dt / 60).toFixed(1)}분`);
}

section("실제 시간이 가장 크게 늘어난 후보");
[...rows]
  .sort((a, b) => b.dt - a.dt)
  .slice(0, 8)
  .forEach((r) => {
    console.log(
      `  d_perp ${r.c.dPerp.toFixed(0).padStart(6)}m  실측 ${(r.dt / 60).toFixed(1).padStart(5)}분  ${r.c.name}`,
    );
  });

console.log(`\nAVG_SPEED=${AVG_SPEED}km/h 기준 ΔD_eff(§6.5)로 환산하면 위 ΔT가 그대로 거리 임계값과 비교됩니다.`);
