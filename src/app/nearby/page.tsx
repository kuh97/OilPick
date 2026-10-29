"use client";

/**
 * 내 주변 주유소 (F10) — PRODUCT.md §5.6, ARCHITECTURE.md §10 Phase 11.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Info,
  MapPin,
  Store,
  Wrench,
  Droplets,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpDrawer } from "@/components/help-drawer";
import { FuelSelect } from "@/components/fuel-select";
import { FilterSheet } from "@/components/result/filter-sheet";
import { NearbyMap } from "@/components/nearby-map";
import {
  useNearbyStations,
  type NearbyPoint,
} from "@/lib/api/useNearbyStations";
import { reverseGeocode } from "@/lib/api/reverseGeocode";
import {
  distanceM as projectedDistanceM,
  wgs84ToProjected,
} from "@/domain/geo";
import { distanceMToKm } from "@/domain/pricing";
import { brandName, wgs84 } from "@/domain/types";
import { useSearchStore } from "@/store/search-store";
import type { WireFilters, WireNearbyStation } from "@/app/api/_lib/types";

function priceDate(iso: string | null): string {
  if (!iso) return "기준일자 정보 없음";
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} 기준`;
}

function distanceFromCurrentLocationM(
  station: WireNearbyStation,
  currentLocation: NearbyPoint,
): number {
  const current = wgs84ToProjected(
    wgs84(currentLocation.lat, currentLocation.lng),
  );
  const stationPoint = wgs84ToProjected(wgs84(station.lat, station.lng));
  return Math.round(projectedDistanceM(current, stationPoint));
}

function NearbyStationSummary({
  station,
  currentLocation,
  refuelAmountL,
}: {
  station: WireNearbyStation;
  currentLocation: NearbyPoint;
  refuelAmountL: number;
}) {
  const distanceM = distanceFromCurrentLocationM(station, currentLocation);

  return (
    <Link
      href={`/station/${station.id}`}
      className="group block rounded-card border border-route-strong/20 bg-surface p-4 shadow-route-sm transition-all hover:border-route-cyan hover:shadow-route-md active:scale-[0.99] md:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-snug text-text-strong">
            {station.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-body">
            <span>{brandName(station.brand)}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-control-sm bg-route-sky px-2.5 py-1 text-xs font-semibold text-route-strong">
          <MapPin className="size-3.5" aria-hidden />
          직선거리 {distanceMToKm(distanceM)}km
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-body">
        {(station.facilities.carWash ||
          station.facilities.maintenance ||
          station.facilities.cvs) && (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {station.facilities.carWash && (
              <span className="flex items-center gap-1">
                <Droplets className="size-3.5" aria-hidden />
                세차
              </span>
            )}
            {station.facilities.maintenance && (
              <span className="flex items-center gap-1">
                <Wrench className="size-3.5" aria-hidden />
                경정비
              </span>
            )}
            {station.facilities.cvs && (
              <span className="flex items-center gap-1">
                <Store className="size-3.5" aria-hidden />
                편의점
              </span>
            )}
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-border pt-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="font-route text-2xl font-bold tracking-tight text-text-strong md:tabular-nums">
            {station.price.toLocaleString()}
            <span className="ml-1 text-base font-medium">원/L</span>
          </p>
          <p className="text-xs text-text-body tabular-nums">
            {priceDate(station.priceUpdatedAt)}
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm text-text-body md:tabular-nums">
        {refuelAmountL}L 주유 시 예상{" "}
        {(station.price * refuelAmountL).toLocaleString()}원
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="flex min-w-0 items-center gap-1.5 break-keep text-xs text-warning-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span>가격은 실제와 다를 수 있습니다.</span>
        </p>
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-route-strong transition-colors group-hover:text-route-blue">
          상세 보기
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export default function NearbyPage() {
  const fuel = useSearchStore((s) => s.fuel);
  const refuelAmountL = useSearchStore((s) => s.vehicle.refuelAmount);
  const filters = useSearchStore((s) => s.filters);
  const setFuel = useSearchStore((s) => s.setFuel);
  const setFilters = useSearchStore((s) => s.setFilters);
  const setNearbyOrigin = useSearchStore((s) => s.setNearbyOrigin);
  const nearbyOrigin = useSearchStore((s) => s.nearbyOrigin);
  const [currentLocation, setCurrentLocation] = useState<NearbyPoint | null>(
    null,
  );
  const [searchCenter, setSearchCenter] = useState<NearbyPoint | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    null,
  );
  const { stations, isLoading, error } = useNearbyStations(
    searchCenter,
    fuel,
    filters,
  );
  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [stations, selectedStationId],
  );
  const hasActiveFilters =
    filters.facilities.length > 0 ||
    filters.brands.length > 0 ||
    filters.kpetroOnly ||
    filters.selfOnly;

  const defaultFilters: WireFilters = {
    facilities: [],
    brands: [],
    kpetroOnly: false,
    selfOnly: false,
  };

  function searchAtPoint(nextPoint: NearbyPoint) {
    setSearchCenter(nextPoint);
    setSelectedStationId(null);
  }

  useEffect(() => {
    if (!navigator.geolocation) {
      window.setTimeout(() => {
        setNearbyOrigin(null);
        setLocationError(true);
      }, 0);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextPoint = { lat: coords.latitude, lng: coords.longitude };
        setCurrentLocation(nextPoint);
        setSearchCenter(nextPoint);
        setNearbyOrigin(nextPoint);
        void reverseGeocode(wgs84(nextPoint.lat, nextPoint.lng)).then(
          (name) => {
            if (name) setNearbyOrigin({ ...nextPoint, name });
          },
        );
      },
      () => {
        setNearbyOrigin(null);
        setLocationError(true);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }, [setNearbyOrigin]);

  return (
    <main className="oilpick-page mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 pb-12 pt-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/home"
            className="text-sm text-text-body transition-colors hover:text-route-strong"
          >
            ← 홈
          </Link>
          <HelpDrawer
            feedbackSource="NEARBY"
            stationId={selectedStation?.id}
            stationName={selectedStation?.name}
            originName={nearbyOrigin?.name}
            destinationName={selectedStation?.name}
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-strong md:text-3xl">
            내 주변 주유소
          </h1>
          <p className="mt-1 text-sm text-text-body">
            현재 위치 기준으로 가까운 주유소를 찾아요.
          </p>
        </div>
      </header>

      {locationError ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-route-strong/15 bg-surface px-4 py-12 text-center shadow-route-sm">
          <MapPin className="size-6 text-route-strong" aria-hidden />
          <p className="text-sm text-text-body">
            현재 위치를 가져오지 못했어요.
          </p>
          <Button
            variant="outline"
            render={<Link href="/home" />}
            nativeButton={false}
          >
            홈에서 장소 직접 입력
          </Button>
        </section>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <FuelSelect value={fuel} onChange={setFuel} />
            </div>
            {currentLocation && searchCenter && (
              <FilterSheet
                filters={filters}
                onApply={setFilters}
                includeDetour={false}
              />
            )}
          </div>
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] md:items-start md:gap-6">
            <section className="relative min-w-0 overflow-hidden rounded-card border border-route-strong/20 bg-surface shadow-route-md">
              {currentLocation && searchCenter && (
                <NearbyMap
                  currentLocation={currentLocation}
                  stations={stations}
                  selectedStationId={selectedStationId}
                  onSelectStation={setSelectedStationId}
                  onSearchAtPoint={searchAtPoint}
                  className="md:h-[clamp(560px,45vw,720px)]"
                />
              )}
              <div
                className="border-t border-border px-4 py-2.5 text-xs text-text-body md:px-5"
                aria-live="polite"
              >
                {isLoading
                  ? "주변 주유소를 찾고 있어요."
                  : "가격 마커를 눌러 선택한 주유소를 확인해보세요."}
              </div>
            </section>

            <aside className="hidden md:sticky md:top-6 md:flex md:flex-col md:gap-4">
              {selectedStation && currentLocation ? (
                <NearbyStationSummary
                  station={selectedStation}
                  currentLocation={currentLocation}
                  refuelAmountL={refuelAmountL}
                />
              ) : (
                <section className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-card border border-route-strong/15 bg-surface px-6 text-center shadow-route-sm">
                  <MapPin className="size-6 text-route-strong" aria-hidden />
                  <p className="text-sm text-text-body">
                    {isLoading
                      ? "주변 주유소를 찾고 있어요."
                      : "지도에서 가격 마커를 눌러보세요."}
                  </p>
                </section>
              )}
            </aside>
          </div>
          {error && (
            <p className="rounded-card border border-border bg-surface-quiet/70 px-4 py-5 text-center text-sm text-text-body">
              {error.message}
            </p>
          )}
          {!isLoading && !error && searchCenter && stations.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface-quiet/70 px-6 py-10 text-center">
              {hasActiveFilters ? (
                <>
                  <p className="text-sm text-text-body">
                    선택하신 필터 조건에 맞는 주유소가 없습니다.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setFilters(defaultFilters)}
                  >
                    필터 초기화하고 다시 찾기
                  </Button>
                </>
              ) : (
                <p className="text-sm text-text-body">
                  3km 안에서 주유소를 찾지 못했어요.
                </p>
              )}
            </div>
          )}
          {selectedStation && currentLocation && (
            <div className="md:hidden">
              <NearbyStationSummary
                station={selectedStation}
                currentLocation={currentLocation}
                refuelAmountL={refuelAmountL}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
