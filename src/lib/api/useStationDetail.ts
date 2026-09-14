"use client";

/**
 * GET /api/stations/:id 소비 — F8 상세 보강. ARCHITECTURE.md §6.4.
 */

import { useEffect, useState } from "react";
import type { WireStationSummary } from "@/app/api/_lib/types";

export interface ApiError {
  code: string;
  message: string;
}

export function useStationDetail(stationId: string | null) {
  const [station, setStation] = useState<WireStationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!stationId) return;
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/stations/${stationId}`, { signal: controller.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
          setError({ code: body.code ?? "NOT_FOUND", message: body.message ?? "주유소를 찾을 수 없습니다." });
          return;
        }
        setStation((await res.json()) as WireStationSummary);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError({ code: "NETWORK_ERROR", message: "상세 정보를 불러오지 못했습니다." });
      } finally {
        setIsLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [stationId]);

  // 요청은 effect에서 시작하므로 첫 렌더에는 내부 isLoading이 아직 false다.
  // stationId가 있는데 결과와 오류가 모두 없으면 응답 대기 중으로 간주해
  // 컨텍스트 없음 화면이 잠깐 노출되지 않게 한다.
  const waitingForInitialResponse = stationId != null && station == null && error == null;
  return { station, isLoading: isLoading || waitingForInitialResponse, error };
}
