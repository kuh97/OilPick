"use client";

/**
 * 내 주변 주유소 (F10) — PRODUCT.md §5.6, ARCHITECTURE.md §10 Phase 11.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Store, Wrench, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpDrawer } from "@/components/help-drawer";
import { FuelSelect } from "@/components/fuel-select";
import { FilterSheet } from "@/components/result/filter-sheet";
import { NearbyMap } from "@/components/nearby-map";
import {
  useNearbyStations,
  type NearbyPoint,
} from "@/lib/api/useNearbyStations";
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
}: {
  station: WireNearbyStation;
  currentLocation: NearbyPoint;
}) {
  const distanceM = distanceFromCurrentLocationM(station, currentLocation);

  return (
    <section className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{station.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {brandName(station.brand)}
          </p>
        </div>
        <p className="shrink-0 text-xl font-bold tracking-tight">
          {station.price.toLocaleString()}원/L
        </p>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        현재 위치에서 {distanceMToKm(distanceM)}km
      </p>
      {(station.facilities.carWash ||
        station.facilities.maintenance ||
        station.facilities.cvs) && (
        <p className="mt-1.5 flex gap-3 text-sm text-muted-foreground">
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
        </p>
      )}
      <div className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>{priceDate(station.priceUpdatedAt)}</span>
          <Link
            href={`/station/${station.id}`}
            className="font-semibold text-primary hover:underline"
          >
            상세 보기
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function NearbyPage() {
  const fuel = useSearchStore((s) => s.fuel);
  const filters = useSearchStore((s) => s.filters);
  const setFuel = useSearchStore((s) => s.setFuel);
  const setFilters = useSearchStore((s) => s.setFilters);
  const setNearbyOrigin = useSearchStore((s) => s.setNearbyOrigin);
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
      },
      () => {
        setNearbyOrigin(null);
        setLocationError(true);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }, [setNearbyOrigin]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href="/home"
          className="justify-self-start text-sm text-muted-foreground"
        >
          ← 홈
        </Link>
        <h1 className="text-base font-semibold">내 주변 주유소</h1>
        <div className="justify-self-end">
          <HelpDrawer stationId={selectedStation?.id} />
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
        <FuelSelect value={fuel} onChange={setFuel} />
      </section>

      {locationError ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center shadow-[var(--shadow-sm)]">
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
          <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-sm)]">
            {currentLocation && searchCenter && (
              <NearbyMap
                currentLocation={currentLocation}
                stations={stations}
                selectedStationId={selectedStationId}
                onSelectStation={setSelectedStationId}
                onSearchAtPoint={searchAtPoint}
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
            <NearbyStationSummary
              station={selectedStation}
              currentLocation={currentLocation}
            />
          )}
        </>
      )}
    </main>
  );
}
