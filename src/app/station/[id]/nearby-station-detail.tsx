"use client";

import { useIsMobile } from "@/lib/use-is-mobile";
import { RouteMap } from "@/components/route-map";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <StationDetailHeader
        backHref="/nearby"
        backLabel="내 주변 주유소"
        stationName={station.name}
        feedbackSource="NEARBY_DETAIL"
        stationId={station.id}
        originName={originName}
        destinationName={station.name}
      />

      {origin && (
        <section className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm shadow-[var(--shadow-sm)]">
          <p className="font-medium">{originName} → 도착지</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            현재 위치에서 {station.name}까지
          </p>
        </section>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] md:items-start md:gap-6">
        <div className="md:sticky md:top-6">
          <RouteMap
            baseRoutePolyline={route?.polyline ?? []}
            station={stationPoint}
            origin={origin ?? undefined}
            destination={origin ? stationPoint : undefined}
            stationLabel="도착"
            showStationMarker={!origin}
            className="md:h-[clamp(420px,42vw,560px)]"
          />

          {origin && (
            <section className="mt-4 rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)] md:p-4">
              <h2 className="text-sm font-semibold">거리</h2>
              {route && (
                <div className="mt-1.5">
                  <div className="flex items-baseline gap-2 md:tabular-nums">
                    <p className="text-2xl font-bold tracking-tight">
                      {distanceMToKm(route.distanceM)}km
                    </p>
                    <span className="text-lg text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <p className="text-xl font-bold tracking-tight">
                      약 {durationSToMin(route.durationS)}분
                    </p>
                  </div>
                </div>
              )}
              {routeLoading && (
                <p className="mt-2 text-sm text-muted-foreground">
                  주유소까지의 도로 경로를 계산하고 있어요.
                </p>
              )}
              {routeError && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {routeError.message} 출발·도착지만 표시합니다.
                </p>
              )}
            </section>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-4 md:mt-0">
          <StationPriceCard
            fuel={fuel}
            price={station.price}
            priceUpdatedAt={station.priceUpdatedAt}
            refuelAmountL={refuelAmountL}
            estimatedTotalWon={
              station.price != null ? Math.round(station.price * refuelAmountL) : null
            }
          />

          <StationInfoCard
            brand={station.brand}
            facilities={station.facilities}
            address={station.address}
            tel={station.tel}
          />

          <Alert variant="warning">
            <AlertTriangle aria-hidden />
            <AlertDescription className="break-keep text-xs text-warning-foreground">
              가격은 실제와 다를 수 있습니다.
            </AlertDescription>
          </Alert>

          {origin && (
            <StationNaviButtons isMobile={isMobile} onClick={handleNaviClick} />
          )}
        </div>
      </div>

    </main>
  );
}
