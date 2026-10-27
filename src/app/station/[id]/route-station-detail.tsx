"use client";

import { useIsMobile } from "@/lib/use-is-mobile";
import { RouteMap } from "@/components/route-map";
import { Lightbulb } from "lucide-react";
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
  Fuel,
  Mode,
  WireCandidate,
  WirePoint,
  WireSearchResult,
  WireVehicle,
} from "@/app/api/_lib/types";
import type { DetourResult } from "@/lib/api/useDetour";
import {
  StationDetailHeader,
  StationDetailTitle,
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

function RouteLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-muted-foreground" aria-hidden />
        기본 경로
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-primary" aria-hidden />
        경유 경로
      </span>
    </div>
  );
}

export function RouteStationDetail({
  candidate,
  result,
  fuel,
  origin,
  destination,
  vehicle,
  mode,
  detour,
}: {
  candidate: WireCandidate;
  result: WireSearchResult;
  fuel: Fuel;
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-1 px-4 py-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <StationDetailHeader
        backHref="/result"
        backLabel="검색 결과"
        stationName={candidate.name}
        feedbackSource="SEARCH_DETAIL"
        stationId={candidate.id}
        searchId={result.searchId}
        originName={origin.name}
        destinationName={destination.name}
      />

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] md:grid-rows-[auto_1fr] md:items-start md:gap-6">
        <div className="mb-4 md:col-start-1 md:row-start-1 md:mb-0">
          <StationDetailTitle stationName={candidate.name} tier={candidate.tier} />
        </div>

        <section className="md:col-start-1 md:row-start-2 md:sticky md:top-6">
          <RouteMap
            baseRoutePolyline={selectedBaseRoute.polyline}
            viaRoutePolyline={detour?.polyline}
            station={{ lat: candidate.lat, lng: candidate.lng }}
            origin={origin}
            destination={destination}
            className="md:h-[clamp(460px,42vw,600px)]"
          />
          <div>
            <RouteLegend />
          </div>
        </section>

        <div className="mt-4 flex flex-col gap-4 md:col-start-2 md:row-start-2 md:mt-0">
          <section className="flex flex-col gap-1 rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 md:p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Lightbulb className="size-4 text-primary" aria-hidden />
              추천 이유
            </h2>
            <p className="text-sm">{candidate.reason}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-blue-100 pt-3">
                <dt className="text-muted-foreground">가격</dt>
                <dd className="text-right">
                  검색 후보 중 {priceRankAmongAll}번째로 저렴
                </dd>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                <dt className="text-muted-foreground">우회</dt>
                <dd className="text-right md:tabular-nums">
                  {!precise && "약 "}+{distanceMToKm(distanceM)}km · +
                  {durationSToMin(durationS)}분
                </dd>
              </div>
              {totalTollWon != null && totalTollWon > 0 && (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                  {/* 정보 표시 전용 — 순이득엔 미반영 */}
                  <dt className="text-muted-foreground">통행료</dt>
                  <dd className="text-right text-muted-foreground md:tabular-nums">
                    {totalTollWon.toLocaleString()}원
                    {additionalTollWon! > 0 &&
                      ` (우회로 +${additionalTollWon!.toLocaleString()}원)`}
                  </dd>
                </div>
              )}
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                <dt className="text-muted-foreground">예상 순이득</dt>
                <dd
                  className={
                    netSavingValue > 0
                      ? "text-right font-medium text-success-foreground md:tabular-nums"
                      : "text-right text-muted-foreground md:tabular-nums"
                  }
                >
                  {netSavingValue > 0
                    ? `+${netSavingValue.toLocaleString()}원`
                    : `${netSavingValue.toLocaleString()}원`}
                </dd>
              </div>
            </dl>
          </section>

          <StationPriceCard
            fuel={fuel}
            price={candidate.price}
            priceUpdatedAt={candidate.priceUpdatedAt}
            refuelAmountL={vehicle.refuelAmount}
            estimatedTotalWon={candidate.estimatedCost}
          />

          <StationInfoCard
            brand={candidate.brand}
            facilities={candidate.facilities}
            address={candidate.address}
            tel={candidate.tel}
          />

          <StationNaviButtons isMobile={isMobile} onClick={handleNaviClick} />
        </div>
      </div>
    </main>
  );
}
