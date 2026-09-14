"use client";

/**
 * POST /api/stations/directions 소비 — F10 주변 상세 지도.
 * 컴포넌트는 카카오 API가 아니라 이 훅만 호출합니다.
 */

import { useEffect, useState } from "react";
import type { WireBaseRoute, WirePoint } from "@/app/api/_lib/types";
import type { ApiError } from "./useStationDetail";

export function useStationRoute(stationId: string | null, origin: WirePoint | null) {
  const [route, setRoute] = useState<WireBaseRoute | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!stationId || !origin) return;
    const controller = new AbortController();
    const requestedOrigin = origin;

    async function run() {
      setRoute(null);
      setError(null);
      setIsLoading(true);
      try {
        const res = await fetch("/api/stations/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationId,
            origin: { lat: requestedOrigin.lat, lng: requestedOrigin.lng },
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
          setError({
            code: body.code ?? "ROUTE_FETCH_FAILED",
            message: body.message ?? "주유소까지의 경로를 계산하지 못했습니다.",
          });
          return;
        }
        setRoute((await res.json()) as WireBaseRoute);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError({ code: "NETWORK_ERROR", message: "주유소까지의 경로를 불러오지 못했습니다." });
      } finally {
        setIsLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [stationId, origin]);

  const waitingForInitialResponse = stationId != null && origin != null && route == null && error == null;
  return { route, isLoading: isLoading || waitingForInitialResponse, error };
}
