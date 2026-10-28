"use client";

/**
 * POST /api/detour 소비 — 주유소 상세 진입 시 lazy 정밀 계산. ARCHITECTURE.md §6.3.
 * 검색 결과의 추정값을 상세 화면에서 실측값으로 교체한다(§5.4).
 */

import { useCallback, useState } from "react";
import type {
  RoutePriority,
  WirePoint,
  WireVehicle,
} from "@/app/api/_lib/types";
import type { ApiError } from "./useStationDetail";

export interface DetourResult {
  distanceM: number;
  durationS: number;
  precise: boolean;
  netSaving: number;
  /** 이 우회로 추가되는 통행료(원, 정보 표시 전용). 모르면 undefined. */
  tollWon?: number;
  /** 경유 경로 폴리라인 — 지도에 "경유 경로(강조)"를 그리는 용도 (§5.4) */
  polyline: WirePoint[];
}

export interface FetchDetourInput {
  origin: WirePoint;
  destination: WirePoint;
  stationId: string;
  vehicle: WireVehicle;
  priceStation: number;
  referencePrice: number;
  /** 검색 때 쓴 값과 같아야 한다 — 기본 경로와 비교 대상이 어긋나면 안 됨. */
  avoidHighway: boolean;
  /** 후보가 선택된 기본 경로 버전으로 다시 계산한다. */
  routePriority?: RoutePriority;
}

export function useDetour() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fetchDetour = useCallback(
    async (input: FetchDetourInput): Promise<DetourResult | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/detour", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = (await res
            .json()
            .catch(() => ({}))) as Partial<ApiError>;
          setError({
            code: body.code ?? "INTERNAL_ERROR",
            message: body.message ?? "정밀 계산에 실패했습니다.",
          });
          return null;
        }
        return (await res.json()) as DetourResult;
      } catch {
        setError({
          code: "NETWORK_ERROR",
          message: "정밀 계산에 실패했습니다.",
        });
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { fetchDetour, isLoading, error };
}
