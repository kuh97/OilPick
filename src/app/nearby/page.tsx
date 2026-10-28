"use client";

/**
 * 내 주변 주유소 (F10) — PRODUCT.md §5.6, ARCHITECTURE.md §10 Phase 11.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Info, MapPin, Store, Wrench, Droplets } from "lucide-react";
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
      className="block rounded-xl border border-border bg-card p-3.5 shadow-route-sm transition-all hover:shadow-route-md active:scale-[0.98] md:p-4"
    >
      <p className="inline-flex items-center gap-1.5 rounded-full bg-route-sky px-2.5 py-0.5 text-xs font-medium text-primary">
        <MapPin className="size-3.5" aria-hidden />
        직선거리 {distanceMToKm(distanceM)}km
      </p>
      <h2 className="mt-2 text-base font-semibold leading-snug">
        {station.name}
      </h2>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <span>{brandName(station.brand)}</span>
        {(station.facilities.carWash ||
          station.facilities.maintenance ||
          station.facilities.cvs) && (
          <span className="flex flex-wrap gap-3">
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
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-2xl font-bold tracking-tight md:tabular-nums">
          {station.price.toLocaleString()}
          <span className="ml-1 text-base font-medium">원/L</span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {priceDate(station.priceUpdatedAt)}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground md:tabular-nums">
        {refuelAmountL}L 주유 시 예상{" "}
        {(station.price * refuelAmountL).toLocaleString()}원
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-2.5">
        <p className="flex min-w-0 items-center gap-1.5 break-keep text-xs text-warning-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span>가격은 실제와 다를 수 있습니다.</span>
        </p>
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary">
          상세 보기
          <ChevronRight className="size-3.5" aria-hidden />
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2 px-4 py-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href="/home"
          className="justify-self-start text-sm text-muted-foreground"
        >
          ← 홈
        </Link>
        <h1 className="text-base font-semibold">내 주변 주유소</h1>
        <div className="justify-self-end">
          <HelpDrawer
            feedbackSource="NEARBY"
            stationId={selectedStation?.id}
            stationName={selectedStation?.name}
            originName={nearbyOrigin?.name}
            destinationName={selectedStation?.name}
          />
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-route-sm md:hidden">
        <FuelSelect value={fuel} onChange={setFuel} />
      </section>

      {locationError ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center shadow-route-sm">
          <MapPin className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
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
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] md:items-start md:gap-6">
            <section className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-route-sm">
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
              {currentLocation && searchCenter && (
                <div className="pointer-events-none absolute right-3 top-3 z-20">
                  <div className="pointer-events-auto">
                    <FilterSheet
                      filters={filters}
                      onApply={setFilters}
                      includeDetour={false}
                    />
                  </div>
                </div>
              )}
              <div className="border-t border-border px-3.5 py-2.5 text-right text-xs text-muted-foreground">
                {isLoading
                  ? "주변 주유소를 찾고 있어요."
                  : "가격 마커를 눌러보세요"}
              </div>
            </section>

            <aside className="hidden md:sticky md:top-6 md:flex md:flex-col md:gap-4">
              <section className="rounded-xl border border-border bg-card p-3.5 shadow-route-sm">
                <FuelSelect value={fuel} onChange={setFuel} />
              </section>

              {selectedStation && currentLocation ? (
                <NearbyStationSummary
                  station={selectedStation}
                  currentLocation={currentLocation}
                  refuelAmountL={refuelAmountL}
                />
              ) : (
                <section className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 text-center shadow-route-sm">
                  <MapPin
                    className="size-6 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="text-sm text-muted-foreground">
                    {isLoading
                      ? "주변 주유소를 찾고 있어요."
                      : "지도에서 가격 마커를 눌러보세요."}
                  </p>
                </section>
              )}
            </aside>
          </div>
          {error && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {error.message}
            </p>
          )}
          {!isLoading && !error && searchCenter && stations.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              {hasActiveFilters ? (
                <>
                  <p className="text-sm text-muted-foreground">
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
                <p className="text-sm text-muted-foreground">
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
