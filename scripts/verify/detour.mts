/**
 * verify:detour (⑭) — 추정 우회 vs 실측 우회 분포 측정.
 *
 * `docs/ARCHITECTURE.md` §12 ⑭ · `docs/PRODUCT.md` §11.3.
 * `DETOUR_TIME_CAP_RATIO`와 "ΔD 단독 판정 폐기(§6.5 ΔD_eff)"의 근거가 노선 1개뿐이라,
 * 노선·연료를 바꿔가며 이 스크립트를 돌려 표본을 늘려야 합니다.
 *
 *   pnpm verify:detour "출발지" "목적지" [GASOLINE|DIESEL|LPG] [샘플수]
 *
 * 검색 파이프라인 STAGE 2와 같은 순서로 후보를 만든 뒤(회랑 수집 → d_perp → 범위
 * 필터 → 우회 허용 시간 예산 + NetSaving 게이트 → 추정 스코어링), 추정 상위 N개에
 * 대해 경유 경로를 실제로 호출해 ΔD·ΔT를 잽니다. 경로 캐시(1시간)를 그대로 타므로
 * 같은 노선을 반복해도 카카오 호출이 늘지 않습니다.
 */

import { searchPlaces } from "@/services/place-service";
import { getRoute } from "@/services/route-service";
import { collectStations } from "@/services/station-service";
import { computeReferencePrice } from "@/services/price-service";
import { wgs84ToProjected, pointToPolylineDistanceM } from "@/domain/geo";
import {
  isOutOfRange,
  routeAvgSpeedKmh,
  estimateDetourDurationSAtSpeed,
} from "@/domain/tier";
import {
  estimateDetourDistanceM,
  estimateDetourDurationS,
  computeScores,
  passesDetourGate,
  gateDetourDistanceM,
  withinDetourBudget,
  scoreByMode,
  exceedsDetourCap,
} from "@/domain/pricing";
import {
  T2_MAX,
  T3_MAX,
  DEFAULT_EFFICIENCY,
  DEFAULT_REFUEL_AMOUNT,
  V_TIME,
  AVG_SPEED,
  DETOUR_TIME_CAP_RATIO,
  DEFAULT_MAX_DETOUR_MINUTES,
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

const vehicle = {
  fuel,
  efficiencyKmPerL: DEFAULT_EFFICIENCY[fuel],
  refuelAmountL: DEFAULT_REFUEL_AMOUNT,
  timeValuePerMin: V_TIME,
};

const collected = await collectStations({
  referencePoints: polyline,
  marginM: T3_MAX,
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
  if (isOutOfRange(dPerp)) continue; // A13 — T3_MAX 초과
  pool.push({ name: station.name, price, dPerp, sigunCd: station.sigunCd, location: station.location });
}

const priceResult = await computeReferencePrice({
  t1t2Prices: pool.filter((c) => c.dPerp <= T2_MAX).map((c) => c.price),
  pool: pool.map((c) => ({ sigunCd: c.sigunCd })),
  fuel,
});
if (!priceResult) abort("P_ref를 계산할 수 없어(A14) 측정을 중단합니다.");
const priceRefWon = priceResult.price;

const routeSpeedKmh = routeAvgSpeedKmh(base.distanceM, base.durationS);
const maxDetourMinutes = DEFAULT_MAX_DETOUR_MINUTES;

const gated = pool.filter((c) => {
  const estimatedDetourDurationS = estimateDetourDurationSAtSpeed(
    gateDetourDistanceM(c.dPerp),
    routeSpeedKmh,
  );
  if (!withinDetourBudget({ estimatedDetourDurationS, maxDetourMinutes })) return false;
  return passesDetourGate({
    priceRefWon,
    priceStationWon: c.price,
    refuelAmountL: vehicle.refuelAmountL,
    dPerpM: c.dPerp,
    efficiencyKmPerL: vehicle.efficiencyKmPerL,
  });
});
info(`후보  수집 ${collected.stations.length} → 범위내 ${pool.length} → 우회게이트 ${gated.length}`);

const estimated = gated.map((c) => {
  const detourDistanceM = estimateDetourDistanceM(c.dPerp);
  const detourDurationS = estimateDetourDurationS(detourDistanceM);
  return {
    c,
    detourDistanceM,
    detourDurationS,
    score: scoreByMode(
      computeScores({
        priceStationWon: c.price,
        refuelAmountL: vehicle.refuelAmountL,
        detourDistanceM,
        detourDurationS,
        efficiencyKmPerL: vehicle.efficiencyKmPerL,
        timeValuePerMin: vehicle.timeValuePerMin,
      }),
      "balanced",
    ),
  };
});
const targets = [...estimated].sort((a, b) => a.score - b.score).slice(0, sampleSize);

section(`실측 (추정 상위 ${targets.length}개, 경유 경로 호출)`);
interface Row { c: Cand; estD: number; estT: number; dd: number; dt: number }
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
      c: chunk[k].c,
      estD: chunk[k].detourDistanceM,
      estT: chunk[k].detourDurationS,
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

section("d_perp 구간별 — 현행 추정 ΔT̂ vs 실측 ΔT 중앙값 (분)");
for (const [lo, hi] of [[0, 200], [200, 500], [500, 1_000], [1_000, 3_000], [3_000, T3_MAX]] as const) {
  const g = rows.filter((r) => r.c.dPerp >= lo && r.c.dPerp < hi);
  if (g.length === 0) continue;
  const real = g.map((r) => r.dt / 60).sort((a, b) => a - b);
  const est = g.map((r) => r.estT / 60).sort((a, b) => a - b);
  console.log(
    `  ${String(lo).padStart(6)}~${String(hi).padStart(6)}m  n=${String(g.length).padStart(3)}  추정 ${quantile(est, 0.5).toFixed(1)}  실측 ${quantile(real, 0.5).toFixed(1)}`,
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

section("추정이 가장 크게 빗나간 후보 (실측 − 추정, 분)");
[...rows]
  .sort((a, b) => (b.dt - b.estT) - (a.dt - a.estT))
  .slice(0, 8)
  .forEach((r) => {
    console.log(
      `  d_perp ${r.c.dPerp.toFixed(0).padStart(6)}m  추정 ${(r.estT / 60).toFixed(1).padStart(5)}분 → 실측 ${(r.dt / 60).toFixed(1).padStart(5)}분  ${r.c.name}`,
    );
  });

console.log(`\nAVG_SPEED=${AVG_SPEED}km/h 기준 ΔD_eff(§6.5)로 환산하면 위 ΔT가 그대로 거리 임계값과 비교됩니다.`);
