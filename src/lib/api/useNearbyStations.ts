"use client";

/**
 * GET /api/stations/nearby 소비 — F10 내 주변 주유소.
 */

import { useEffect, useState } from "react";
import type { Fuel, WireNearbyStation } from "@/app/api/_lib/types";

export interface NearbyPoint {
  lat: number;
  lng: number;
}

export interface NearbyApiError {
  code: string;
  message: string;
}

export function useNearbyStations(
  point: NearbyPoint | null,
  fuel: Fuel,
) {
  const [stations, setStations] = useState<WireNearbyStation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<NearbyApiError | null>(null);

  useEffect(() => {
    if (!point) return;
    const requestedPoint = point;
    const controller = new AbortController();

    async function run() {
      setStations([]);
      setError(null);
      setIsLoading(true);
      try {
      const query = new URLSearchParams({
        lat: String(requestedPoint.lat),
        lng: String(requestedPoint.lng),
        fuel,
      });
        const res = await fetch(`/api/stations/nearby?${query}`, { signal: controller.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Partial<NearbyApiError>;
          setError({ code: body.code ?? "INTERNAL_ERROR", message: body.message ?? "주변 주유소를 찾지 못했습니다." });
          return;
        }
        const body = (await res.json()) as { stations: WireNearbyStation[] };
        setStations(body.stations);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError({ code: "NETWORK_ERROR", message: "주변 주유소를 불러오지 못했습니다." });
      } finally {
        setIsLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [point, fuel]);

  return { stations, isLoading, error };
}
