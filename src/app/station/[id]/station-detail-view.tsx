"use client";

/**
 * 상세 (F8·F9) — PRODUCT.md §5.4·§5.5, ARCHITECTURE.md §10 Phase 9.
 *
 * 스토어의 검색 컨텍스트와 독립 상세 API를 조합하고, 실제 상세 화면은
 * `route-station-detail.tsx`와 `nearby-station-detail.tsx`에 위임한다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSearchStore } from "@/store/search-store";
import { useDetour, type DetourResult } from "@/lib/api/useDetour";
import { useStationDetail } from "@/lib/api/useStationDetail";
import { useStationRoute } from "@/lib/api/useStationRoute";
import { recomputeCandidate } from "@/lib/recompute-candidates";
import { NearbyStationDetail } from "./nearby-station-detail";
import { RouteStationDetail } from "./route-station-detail";

/** 라우트 파라미터 언래핑과 실제 화면 로직을 분리 — 후자만 별도로 렌더 테스트한다. */
export function StationDetailView({ id }: { id: string }) {
  const origin = useSearchStore((s) => s.origin);
  const destination = useSearchStore((s) => s.destination);
  const nearbyOrigin = useSearchStore((s) => s.nearbyOrigin);
  const result = useSearchStore((s) => s.result);
  const vehicle = useSearchStore((s) => s.vehicle);
  const fuel = useSearchStore((s) => s.fuel);
  const mode = useSearchStore((s) => s.mode);
  const avoidHighway = useSearchStore((s) => s.avoidHighway);
  const rawCandidate = result?.candidates.find((c) => c.id === id) ?? null;
  const hasSearchContext =
    origin != null &&
    destination != null &&
    result != null &&
    rawCandidate != null;
  const standaloneDetail = useStationDetail(hasSearchContext ? null : id, fuel);
  const stationRoute = useStationRoute(
    hasSearchContext || !nearbyOrigin ? null : id,
    nearbyOrigin,
  );

  const { fetchDetour } = useDetour();
  const [detour, setDetour] = useState<DetourResult | null>(null);

  const candidate = rawCandidate
    ? recomputeCandidate(rawCandidate, vehicle, result?.referencePrice ?? null)
    : null;

  useEffect(() => {
    if (!candidate || !origin || !destination) return;
    let cancelled = false;

    async function run() {
      setDetour(null);
      const res = await fetchDetour({
        origin: origin!,
        destination: destination!,
        stationId: candidate!.id,
        vehicle,
        priceStation: candidate!.price,
        referencePrice: result?.referencePrice ?? candidate!.price,
        avoidHighway,
        routePriority: candidate!.routePriority ?? "RECOMMEND",
      });
      if (!cancelled && res) setDetour(res);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // candidate.id가 바뀔 때만 재요청 — vehicle 변경은 화면에서 이미 recompute로 반영됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id, origin, destination]);

  if (!origin || !destination || !result || !candidate) {
    if (standaloneDetail.isLoading) {
      return (
        <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-16 text-sm text-muted-foreground">
          주유소 정보를 불러오는 중이에요.
        </main>
      );
    }
    if (standaloneDetail.station) {
      return (
        <NearbyStationDetail
          station={standaloneDetail.station}
          fuel={fuel}
          origin={nearbyOrigin}
          route={stationRoute.route}
          routeLoading={stationRoute.isLoading}
          routeError={stationRoute.error}
          refuelAmountL={vehicle.refuelAmount}
        />
      );
    }
    if (standaloneDetail.error) {
      return (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {standaloneDetail.error.message}
          </p>
          <Button render={<Link href="/nearby" />} nativeButton={false}>
            주변 주유소로 돌아가기
          </Button>
        </main>
      );
    }
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          검색 컨텍스트가 없습니다. 홈에서 먼저 검색해주세요.
        </p>
        <Button render={<Link href="/home" />} nativeButton={false}>
          홈으로
        </Button>
      </main>
    );
  }

  return (
    <RouteStationDetail
      candidate={candidate}
      result={result}
      fuel={fuel}
      origin={origin}
      destination={destination}
      vehicle={vehicle}
      mode={mode}
      detour={detour}
    />
  );
}
