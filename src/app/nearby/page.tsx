"use client";

/**
 * 내 주변 주유소 (F10) — PRODUCT.md §5.6, ARCHITECTURE.md §10 Phase 11.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Navigation, Store, Wrench, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FuelSelect } from "@/components/fuel-select";
import { useNearbyStations, type NearbyPoint } from "@/lib/api/useNearbyStations";
import { distanceMToKm } from "@/domain/pricing";
import { brandName } from "@/domain/types";
import { useSearchStore } from "@/store/search-store";
import type { WireNearbyStation } from "@/app/api/_lib/types";

function priceDate(iso: string | null): string {
  if (!iso) return "기준일자 정보 없음";
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} 기준`;
}

function NearbyStationCard({ station }: { station: WireNearbyStation }) {
  return (
    <Link
      href={`/station/${station.id}`}
      className="block rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)] transition-all hover:shadow-[var(--shadow-md)] active:scale-[0.98]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{station.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{brandName(station.brand)}</p>
        </div>
        <p className="shrink-0 text-xl font-bold tracking-tight">{station.price.toLocaleString()}원/L</p>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">현재 위치에서 {distanceMToKm(station.distanceM)}km</p>
      {(station.facilities.carWash || station.facilities.maintenance || station.facilities.cvs) && (
        <p className="mt-1.5 flex gap-3 text-sm text-muted-foreground">
          {station.facilities.carWash && <span className="flex items-center gap-1"><Droplets className="size-3.5" aria-hidden />세차</span>}
          {station.facilities.maintenance && <span className="flex items-center gap-1"><Wrench className="size-3.5" aria-hidden />경정비</span>}
          {station.facilities.cvs && <span className="flex items-center gap-1"><Store className="size-3.5" aria-hidden />편의점</span>}
        </p>
      )}
      <div className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
        {priceDate(station.priceUpdatedAt)}
      </div>
    </Link>
  );
}

export default function NearbyPage() {
  const fuel = useSearchStore((s) => s.fuel);
  const setFuel = useSearchStore((s) => s.setFuel);
  const setNearbyOrigin = useSearchStore((s) => s.setNearbyOrigin);
  const [sort, setSort] = useState<"price" | "distance">("price");
  const [point, setPoint] = useState<NearbyPoint | null>(null);
  const [locationError, setLocationError] = useState(false);
  const { stations, isLoading, error } = useNearbyStations(point, fuel);
  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => (sort === "distance" ? a.distanceM - b.distanceM : a.price - b.price)),
    [stations, sort],
  );

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
        setPoint(nextPoint);
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
      <header className="flex items-center justify-between">
        <Link href="/home" className="text-sm text-muted-foreground">← 홈</Link>
        <h1 className="text-base font-semibold">내 주변 주유소</h1>
        <span className="size-8" aria-hidden />
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Navigation className="size-4 text-primary" aria-hidden />
          현재 위치 기준 5km
        </div>
        <FuelSelect value={fuel} onChange={setFuel} />
      </section>

      {locationError ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center shadow-[var(--shadow-sm)]">
          <MapPin className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">현재 위치를 가져오지 못했어요.</p>
          <Button variant="outline" render={<Link href="/home" />} nativeButton={false}>홈에서 장소 직접 입력</Button>
        </section>
      ) : (
        <>
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="주변 주유소 정렬">
            <button type="button" role="tab" aria-selected={sort === "price"} onClick={() => setSort("price")} className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${sort === "price" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>가격순</button>
            <button type="button" role="tab" aria-selected={sort === "distance"} onClick={() => setSort("distance")} className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${sort === "distance" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>거리순</button>
          </div>
          {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">주변 주유소를 찾고 있어요.</p>}
          {error && <p className="py-8 text-center text-sm text-muted-foreground">{error.message}</p>}
          {!isLoading && !error && point && stations.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">5km 안에서 주유소를 찾지 못했어요.</p>
          )}
          <div className="flex flex-col gap-3">
            {sortedStations.map((station) => <NearbyStationCard key={station.id} station={station} />)}
          </div>
        </>
      )}
    </main>
  );
}
