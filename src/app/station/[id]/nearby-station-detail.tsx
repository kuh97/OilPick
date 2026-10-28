"use client";

import { useIsMobile } from "@/lib/use-is-mobile";
import { CircleSmall, MapPin } from "lucide-react";
import { RouteMap } from "@/components/route-map";
import { distanceMToKm, durationSToMin } from "@/domain/pricing";
import {
  buildStationDeeplink,
  buildStationWebFallbackUrl,
  type NaviApp,
} from "@/domain/deeplink";
import { wgs84 } from "@/domain/types";
import type {
  Fuel,
  WireBaseRoute,
  WirePoint,
  WireStationSummary,
} from "@/app/api/_lib/types";
import {
  StationDetailHeader,
  StationDetailTitle,
  StationInfoCard,
  StationNaviButtons,
  StationPriceCard,
} from "./station-detail-shared";

export function NearbyStationDetail({
  station,
  fuel,
  origin,
  route,
  routeLoading,
  routeError,
  refuelAmountL,
}: {
  station: WireStationSummary;
  fuel: Fuel;
  origin: WirePoint | null;
  route: WireBaseRoute | null;
  routeLoading: boolean;
  routeError: { message: string } | null;
  refuelAmountL: number;
}) {
  const isMobile = useIsMobile();
  const stationPoint = wgs84(station.lat, station.lng);
  const originName = origin?.name ?? "내 위치";

  function handleNaviClick(app: NaviApp, appName?: string) {
    if (!origin) return;
    const deeplinkInput = {
      app,
      origin: wgs84(origin.lat, origin.lng),
      destination: stationPoint,
      originName,
      destinationName: station.name,
      appName,
    };
    const webFallback =
      isMobile === false ? buildStationWebFallbackUrl(deeplinkInput) : null;
    if (webFallback) {
      window.open(webFallback, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(buildStationDeeplink(deeplinkInput));
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2 px-4 py-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <StationDetailHeader
        backHref="/nearby"
        backLabel="내 주변 주유소"
        stationName={station.name}
        feedbackSource="NEARBY_DETAIL"
        stationId={station.id}
        originName={originName}
        destinationName={station.name}
      />

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(340px,360px)] md:grid-rows-[auto_1fr] md:items-start md:gap-6">
        <div className="md:col-start-1 md:row-start-1">
          <StationDetailTitle stationName={station.name} />
        </div>

        <div className="md:col-start-1 md:row-start-2 md:sticky md:top-6">
          <section className="overflow-hidden rounded-card border border-route-strong/15 bg-surface shadow-route-sm">
            <RouteMap
              baseRoutePolyline={route?.polyline ?? []}
              station={stationPoint}
              origin={origin ?? undefined}
              destination={origin ? stationPoint : undefined}
              stationLabel="도착"
              showStationMarker={!origin}
              className="md:h-[clamp(460px,42vw,600px)]"
            />
          </section>
          <div className="mt-2 px-1 pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-body">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-full bg-text-muted"
                  aria-hidden
                />
                기본 경로
              </span>
            </div>
          </div>
        </div>

        <div className="mt-0 flex flex-col gap-5 md:col-start-2 md:row-start-2 md:mt-0 md:gap-6">
          {origin && (
            <section
              aria-label="이동 정보"
              className="rounded-card border border-route-strong/20 bg-surface p-4 shadow-route-sm md:p-5"
            >
              <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
                <div className="relative row-span-2 flex flex-col items-center justify-between self-stretch">
                  <span
                    className="absolute top-[24.5px] left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                    aria-hidden
                  >
                    <span className="h-1 w-0.5 rounded-full bg-primary" />
                    <span className="h-1 w-0.5 rounded-full bg-primary" />
                    <span className="h-1 w-0.5 rounded-full bg-primary" />
                  </span>
                  <CircleSmall
                    className="relative size-4 fill-surface text-route-strong"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <MapPin
                    className="relative size-4 fill-surface text-route-strong"
                    strokeWidth={2}
                    aria-hidden
                  />
                </div>
                <p className="min-w-0 truncate text-sm font-semibold text-text-strong">
                  {originName} <span className="text-text-body">(현위치)</span>
                </p>
                <p className="mt-3 min-w-0 truncate text-sm font-semibold text-text-strong">
                  {station.name}
                </p>
                <div className="col-start-2 mt-2 text-sm text-text-body tabular-nums">
                  {route ? (
                    <span>
                      기본 경로 {distanceMToKm(route.distanceM)}km · 약{" "}
                      {durationSToMin(route.durationS)}분
                    </span>
                  ) : routeLoading ? (
                    <span className="text-text-body">
                      경로를 계산하고 있어요.
                    </span>
                  ) : routeError ? (
                    <span className="text-text-body">{routeError.message}</span>
                  ) : (
                    <span className="text-text-body">정보 없음</span>
                  )}
                </div>
              </div>
            </section>
          )}

          <StationPriceCard
            fuel={fuel}
            price={station.price}
            priceUpdatedAt={station.priceUpdatedAt}
            refuelAmountL={refuelAmountL}
            estimatedTotalWon={
              station.price != null
                ? Math.round(station.price * refuelAmountL)
                : null
            }
          />

          <StationInfoCard
            brand={station.brand}
            facilities={station.facilities}
            address={station.address}
            tel={station.tel}
          />

          {origin && (
            <StationNaviButtons isMobile={isMobile} onClick={handleNaviClick} />
          )}
        </div>
      </div>
    </main>
  );
}
