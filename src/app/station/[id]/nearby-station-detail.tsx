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
        </div>

        <div className="mt-4 flex flex-col gap-4 md:mt-0">
          {origin && (
            <section className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)] md:p-4">
              <h2 className="text-sm font-semibold">이동 정보</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex gap-3">
                  <dt className="w-10 shrink-0 text-muted-foreground">출발</dt>
                  <dd className="min-w-0 truncate">
                    {originName}{" "}
                    <span className="text-muted-foreground">(현위치)</span>
                  </dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-10 shrink-0 text-muted-foreground">도착</dt>
                  <dd className="min-w-0 truncate">{station.name}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-10 shrink-0 text-muted-foreground">거리</dt>
                  <dd className="min-w-0">
                    {route ? (
                      <span className="font-semibold md:tabular-nums">
                        {distanceMToKm(route.distanceM)}km · 약 {durationSToMin(route.durationS)}분
                      </span>
                    ) : routeLoading ? (
                      <span className="text-muted-foreground">
                        경로를 계산하고 있어요.
                      </span>
                    ) : routeError ? (
                      <span className="text-muted-foreground">
                        {routeError.message}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">정보 없음</span>
                    )}
                  </dd>
                </div>
              </dl>
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
