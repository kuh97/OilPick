"use client";

/**
 * 상세 (F8·F9) — PRODUCT.md §5.4·§5.5, ARCHITECTURE.md §10 Phase 9.
 *
 * 검색 컨텍스트(스토어의 result)에서 후보를 찾아 보여준다. 딥링크 미설치
 * 폴백(폴백 타이머·스토어 이동)은 Phase 10 범위라 여기서는 스킴 링크만 연결한다.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Droplets,
  Lightbulb,
  PhoneCall,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TierBadge } from "@/components/result/tier-badge";
import { RouteMap } from "@/components/route-map";
import { useSearchStore } from "@/store/search-store";
import { useDetour, type DetourResult } from "@/lib/api/useDetour";
import { useIsMobile } from "@/lib/use-is-mobile";
import {
  recomputeAndSort,
  recomputeCandidate,
} from "@/lib/recompute-candidates";
import { distanceMToKm, durationSToMin } from "@/domain/pricing";
import { brandName, wgs84 } from "@/domain/types";
import {
  buildDeeplink,
  buildWebFallbackUrl,
  type NaviApp,
} from "@/domain/deeplink";
import type { NaviEvent } from "@/app/api/_lib/schema";

const NAVI_APPS: { app: NaviApp; label: string; appName?: string }[] = [
  { app: "KAKAO", label: "카카오맵" },
  { app: "NAVER", label: "네이버지도", appName: "oilpick" },
  { app: "TMAP", label: "티맵" },
];

function reportNaviClick(event: NaviEvent) {
  // 직후에 window.location.assign으로 이동하므로 fetch는 종종 중단된다 —
  // sendBeacon은 페이지 이동 중에도 전송을 보장한다.
  const body = new Blob([JSON.stringify(event)], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/events/navi", body)) {
    void fetch("/api/events/navi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {});
  }
}

export default function StationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <StationDetailView id={id} />;
}

/** 라우트 파라미터 언래핑과 실제 화면 로직을 분리 — 후자만 별도로 렌더 테스트한다. */
export function StationDetailView({ id }: { id: string }) {
  const origin = useSearchStore((s) => s.origin);
  const destination = useSearchStore((s) => s.destination);
  const result = useSearchStore((s) => s.result);
  const vehicle = useSearchStore((s) => s.vehicle);
  const mode = useSearchStore((s) => s.mode);
  const avoidHighway = useSearchStore((s) => s.avoidHighway);

  const { fetchDetour } = useDetour();
  const [detour, setDetour] = useState<DetourResult | null>(null);
  // 티맵은 웹 길찾기가 없어(domain/deeplink.ts buildWebFallbackUrl 참고) 모바일에서만 노출한다.
  const isMobile = useIsMobile();
  const visibleNaviApps = NAVI_APPS.filter(
    ({ app }) => app !== "TMAP" || isMobile,
  );

  const rawCandidate = result?.candidates.find((c) => c.id === id) ?? null;
  const candidate = rawCandidate
    ? recomputeCandidate(rawCandidate, vehicle, result?.referencePrice ?? null)
    : null;

  useEffect(() => {
    if (!candidate || !origin || !destination) return;
    let cancelled = false;

    async function run() {
      setDetour(null);
      const res = await fetchDetour({
        origin: origin!,
        destination: destination!,
        stationId: candidate!.id,
        vehicle,
        priceStation: candidate!.price,
        referencePrice: result?.referencePrice ?? candidate!.price,
        avoidHighway,
      });
      if (!cancelled && res) setDetour(res);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // candidate.id가 바뀔 때만 재요청 — vehicle 변경은 화면에서 이미 recompute로 반영됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id, origin, destination]);

  if (!origin || !destination || !result || !candidate) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          검색 컨텍스트가 없습니다. 홈에서 먼저 검색해주세요.
        </p>
        <Button render={<Link href="/home" />} nativeButton={false}>
          홈으로
        </Button>
      </main>
    );
  }

  const distanceM = detour?.distanceM ?? candidate.detour.distanceM;
  const durationS = detour?.durationS ?? candidate.detour.durationS;
  const netSavingValue = detour?.netSaving ?? candidate.netSaving;
  const tollWon = detour?.tollWon ?? candidate.detour.tollWon;
  const precise = detour != null;

  const rank =
    recomputeAndSort(
      result.candidates,
      vehicle,
      result.referencePrice,
      mode,
    ).findIndex((c) => c.id === id) + 1;
  const priceRankAmongAll =
    [...result.candidates]
      .sort((a, b) => a.price - b.price)
      .findIndex((c) => c.id === id) + 1;

  function handleNaviClick(app: NaviApp, appName?: string) {
    const deeplinkInput = {
      app,
      origin: wgs84(origin!.lat, origin!.lng),
      destination: wgs84(destination!.lat, destination!.lng),
      waypoint: wgs84(candidate!.lat, candidate!.lng),
      originName: origin!.name,
      destinationName: destination!.name,
      waypointName: candidate!.name,
      appName,
    };
    reportNaviClick({
      searchId: result!.searchId,
      app,
      rank,
      tier: candidate!.tier,
      netSaving: netSavingValue,
      detourDistanceM: distanceM,
    });

    // 앱 스킴을 처리할 핸들러가 없는 데스크톱에서는 PC 웹 지도로 폴백한다.
    const webFallback = !isMobile ? buildWebFallbackUrl(deeplinkInput) : null;
    if (webFallback) {
      window.open(webFallback, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(buildDeeplink(deeplinkInput));
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <Link href="/result" className="text-sm text-muted-foreground">
          ← {candidate.name}
        </Link>
        <TierBadge tier={candidate.tier} />
      </header>

      <RouteMap
        baseRoutePolyline={result.baseRoute.polyline}
        viaRoutePolyline={detour?.polyline}
        station={{ lat: candidate.lat, lng: candidate.lng }}
        origin={origin}
        destination={destination}
      />

      <section className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Lightbulb className="size-4 text-primary" aria-hidden />
          추천 이유
        </h2>
        <p className="text-sm">{candidate.reason}</p>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">가격</dt>
          <dd>
            이 경로 {result.candidates.length}곳 중 {priceRankAmongAll}번째로 저렴
          </dd>
          <dt className="text-muted-foreground">우회</dt>
          <dd>
            {!precise && "약 "}
            {distanceMToKm(distanceM)}km / {durationSToMin(durationS)}분
          </dd>
          {tollWon != null && tollWon > 0 && (
            <>
              {/* 정보 표시 전용 — 순이득 계산엔 반영하지 않는다 (2026-09-08). */}
              <dt className="text-muted-foreground">추가 통행료</dt>
              <dd className="text-muted-foreground">+{tollWon.toLocaleString()}원</dd>
            </>
          )}
          <dt className="text-muted-foreground">순이득</dt>
          <dd className={netSavingValue > 0 ? "font-medium text-success-foreground" : "text-muted-foreground"}>
            {netSavingValue > 0
              ? `+${netSavingValue.toLocaleString()}원`
              : `${netSavingValue.toLocaleString()}원`}
          </dd>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
        <h2 className="mb-1 text-sm font-semibold">가격</h2>
        <p className="text-xl font-bold tracking-tight">
          {candidate.price.toLocaleString()}원/L
        </p>
        <p className="text-sm text-muted-foreground">
          {vehicle.refuelAmount}L 주유 시 예상{" "}
          {candidate.estimatedCost.toLocaleString()}원
        </p>
      </section>

      <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 text-sm shadow-[var(--shadow-sm)]">
        <div className="flex gap-3 text-muted-foreground">
          {candidate.facilities.carWash && (
            <span className="flex items-center gap-1">
              <Droplets className="size-3.5" aria-hidden />
              세차
            </span>
          )}
          {candidate.facilities.maintenance && (
            <span className="flex items-center gap-1">
              <Wrench className="size-3.5" aria-hidden />
              경정비
            </span>
          )}
          {candidate.facilities.cvs && (
            <span className="flex items-center gap-1">
              <Store className="size-3.5" aria-hidden />
              편의점
            </span>
          )}
        </div>
        <p className="text-muted-foreground">{brandName(candidate.brand)}</p>
        <p className="text-muted-foreground">{candidate.address}</p>
        {candidate.tel && (
          <a
            href={`tel:${candidate.tel}`}
            className="flex items-center gap-1 text-primary underline"
          >
            <PhoneCall className="size-3.5" aria-hidden />
            {candidate.tel} — 전화걸기
          </a>
        )}
      </section>

      <Alert variant="warning">
        <AlertTriangle aria-hidden />
        <AlertDescription className="text-xs text-warning-foreground">
          가격은 실제와 다를 수 있습니다.
          {candidate.tier === "T3" &&
            " 먼 거리를 우회하므로 전화 확인을 권합니다."}
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2">
        {visibleNaviApps.map(({ app, label, appName }) => (
          <Button
            key={app}
            variant="outline"
            size="lg"
            onClick={() => handleNaviClick(app, appName)}
          >
            {label}
          </Button>
        ))}
        {isMobile && (
          <p className="text-xs text-muted-foreground">
            티맵은 주유소까지만 안내됩니다. 주유 후 최종 목적지를 다시
            입력해주세요.
          </p>
        )}
      </div>
    </main>
  );
}
