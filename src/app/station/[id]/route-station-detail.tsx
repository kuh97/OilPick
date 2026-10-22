"use client";

import { useIsMobile } from "@/lib/use-is-mobile";
import { RouteMap } from "@/components/route-map";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { distanceMToKm, durationSToMin } from "@/domain/pricing";
import {
  buildDeeplink,
  buildWebFallbackUrl,
  type NaviApp,
} from "@/domain/deeplink";
import { wgs84 } from "@/domain/types";
import { recomputeAndSort } from "@/lib/recompute-candidates";
import type { NaviEvent } from "@/app/api/_lib/schema";
import type {
  Mode,
  WireCandidate,
  WirePoint,
  WireSearchResult,
  WireVehicle,
} from "@/app/api/_lib/types";
import type { DetourResult } from "@/lib/api/useDetour";
import {
  StationDetailHeader,
  StationInfoCard,
  StationNaviButtons,
  StationPriceCard,
} from "./station-detail-shared";

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

export function RouteStationDetail({
  candidate,
  result,
  origin,
  destination,
  vehicle,
  mode,
  detour,
}: {
  candidate: WireCandidate;
  result: WireSearchResult;
  origin: WirePoint;
  destination: WirePoint;
  vehicle: WireVehicle;
  mode: Mode;
  detour: DetourResult | null;
}) {
  const isMobile = useIsMobile();
  const distanceM = detour?.distanceM ?? candidate.detour.distanceM;
  const durationS = detour?.durationS ?? candidate.detour.durationS;
  const netSavingValue = detour?.netSaving ?? candidate.netSaving;
  const selectedBaseRoute =
    result.baseRoutes?.find(
      ({ priority }) => priority === (candidate.routePriority ?? "RECOMMEND"),
    )?.route ?? result.baseRoute;
  // 총 통행료 = 기본 경로 통행료 + 이 우회로 추가되는 분. 델타만 보여주면 기본 경로가
  // 이미 유료도로면 통행료가 없는 것처럼 보인다(2026-09-08). 둘 다 알 때만 합산.
  const additionalTollWon = detour?.tollWon ?? candidate.detour.tollWon;
  const baseTollWon = selectedBaseRoute.tollWon;
  const totalTollWon =
    baseTollWon != null && additionalTollWon != null
      ? baseTollWon + additionalTollWon
      : undefined;
  const precise = detour != null;

  const rank =
    recomputeAndSort(
      result.candidates,
      vehicle,
      result.referencePrice,
      mode,
    ).findIndex((c) => c.id === candidate.id) + 1;
  const priceRankAmongAll =
    [...result.candidates]
      .sort((a, b) => a.price - b.price)
      .findIndex((c) => c.id === candidate.id) + 1;

  function handleNaviClick(app: NaviApp, appName?: string) {
    const deeplinkInput = {
      app,
      origin: wgs84(origin.lat, origin.lng),
      destination: wgs84(destination.lat, destination.lng),
      waypoint: wgs84(candidate.lat, candidate.lng),
      originName: origin.name,
      destinationName: destination.name,
      waypointName: candidate.name,
      appName,
    };
    reportNaviClick({
      searchId: result.searchId,
      app,
      rank,
      tier: candidate.tier,
      netSaving: netSavingValue,
      detourDistanceM: distanceM,
    });

    // 앱 스킴을 처리할 핸들러가 없는 데스크톱에서는 PC 웹 지도로 폴백한다.
    const webFallback =
      isMobile === false ? buildWebFallbackUrl(deeplinkInput) : null;
    if (webFallback) {
      window.open(webFallback, "_blank", "noopener,noreferrer");
      return;
    }

    const appUrl = buildDeeplink(deeplinkInput);

    // 모바일 웹은 앱 설치 여부를 확정할 수 없어 스토어 폴백 없이 스킴만 시도한다.
    window.location.assign(appUrl);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <StationDetailHeader
        backHref="/result"
        backLabel="검색 결과"
        stationName={candidate.name}
        feedbackSource="SEARCH_DETAIL"
        tier={candidate.tier}
        stationId={candidate.id}
        searchId={result.searchId}
        originName={origin.name}
        destinationName={destination.name}
      />

      <RouteMap
        baseRoutePolyline={selectedBaseRoute.polyline}
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
            이 경로 {result.candidates.length}곳 중 {priceRankAmongAll}번째로
            저렴
          </dd>
          <dt className="text-muted-foreground">우회</dt>
          <dd>
            {!precise && "약 "}
            {distanceMToKm(distanceM)}km / {durationSToMin(durationS)}분
          </dd>
          {totalTollWon != null && totalTollWon > 0 && (
            <>
              {/* 정보 표시 전용 — 순이득엔 미반영 */}
              <dt className="text-muted-foreground">통행료</dt>
              <dd className="text-muted-foreground">
                {totalTollWon.toLocaleString()}원
                {additionalTollWon! > 0 &&
                  ` (우회로 +${additionalTollWon!.toLocaleString()}원)`}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">순이득</dt>
          <dd
            className={
              netSavingValue > 0
                ? "font-medium text-success-foreground"
                : "text-muted-foreground"
            }
          >
            {netSavingValue > 0
              ? `+${netSavingValue.toLocaleString()}원`
              : `${netSavingValue.toLocaleString()}원`}
          </dd>
        </dl>
      </section>

      <StationPriceCard
        price={candidate.price}
        refuelAmountL={vehicle.refuelAmount}
        estimatedTotalWon={candidate.estimatedCost}
      />

      <StationInfoCard
        brand={candidate.brand}
        facilities={candidate.facilities}
        address={candidate.address}
        tel={candidate.tel}
      />

      <Alert variant="warning">
        <AlertTriangle aria-hidden />
        <AlertDescription className="break-keep text-xs text-warning-foreground">
          가격은 실제와 다를 수 있습니다.
          {candidate.tier === "DETOUR" &&
            " 먼 거리를 우회하므로 전화 확인을 권합니다."}
        </AlertDescription>
      </Alert>

      <StationNaviButtons isMobile={isMobile} onClick={handleNaviClick} />
    </main>
  );
}
