"use client";

/**
 * 홈 (F1) — 경로 입력. PRODUCT.md §5.1, ARCHITECTURE.md §10 Phase 9.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PlaceAutocompleteInput } from "@/components/place-autocomplete";
import { FuelSelect } from "@/components/fuel-select";
import { HomeMap, type HomeMapField } from "@/components/home-map";
import { useSearchStore } from "@/store/search-store";
import { wgs84 } from "@/domain/types";
import { wgs84ToProjected, distanceM } from "@/domain/geo";
import { MIN_OD_GAP } from "@/domain/params";
import type { WirePoint } from "@/app/api/_lib/types";

function gapMeters(a: WirePoint, b: WirePoint): number {
  return distanceM(
    wgs84ToProjected(wgs84(a.lat, a.lng)),
    wgs84ToProjected(wgs84(b.lat, b.lng)),
  );
}

export default function HomePage() {
  const router = useRouter();
  const origin = useSearchStore((s) => s.origin);
  const destination = useSearchStore((s) => s.destination);
  const fuel = useSearchStore((s) => s.fuel);
  const avoidHighway = useSearchStore((s) => s.avoidHighway);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const setOrigin = useSearchStore((s) => s.setOrigin);
  const setDestination = useSearchStore((s) => s.setDestination);
  const setFuel = useSearchStore((s) => s.setFuel);
  const setAvoidHighway = useSearchStore((s) => s.setAvoidHighway);

  const [activeField, setActiveField] = useState<HomeMapField>("origin");
  // "다시입력"을 누르면 입력창에 남아있는 편집 중 텍스트(아직 좌표로 확정 안 된 상태 —
  // 즉 value는 이미 null이라 diff로는 안 잡힘)까지 확실히 지워야 하므로, key를 바꿔
  // PlaceAutocompleteInput을 통째로 리마운트시킨다.
  const [resetToken, setResetToken] = useState(0);

  const tooClose = useMemo(
    () =>
      origin && destination
        ? gapMeters(origin, destination) < MIN_OD_GAP
        : false,
    [origin, destination],
  );
  const canSearch = origin != null && destination != null && !tooClose;

  function swapOriginDestination() {
    setOrigin(destination);
    setDestination(origin);
  }

  function resetRoute() {
    setOrigin(null);
    setDestination(null);
    setActiveField("origin");
    setResetToken((n) => n + 1);
  }

  function handleMapPick(field: HomeMapField, point: WirePoint) {
    if (field === "origin") setOrigin(point);
    else setDestination(point);
  }

  function handleSearch() {
    if (!canSearch || !origin || !destination) return;
    useSearchStore.getState().addRecentSearch({ origin, destination, fuel });
    router.push("/result");
  }

  function applyRecent(entry: (typeof recentSearches)[number]) {
    setOrigin(entry.origin);
    setDestination(entry.destination);
    setFuel(entry.fuel);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="flex items-center gap-2">
        <svg viewBox="0 0 100 100" width="32" height="32" aria-hidden>
          <rect width="100" height="100" rx="22" ry="22" fill="#3182F6" />
          <g transform="translate(50,50) scale(0.8) translate(-50,-50)">
            <path
              d="M50 8 C33 30 22 46 22 64 C22 79.46 34.54 92 50 92 C65.46 92 78 79.46 78 64 C78 46 67 30 50 8 Z"
              fill="#FFFFFF"
            />
            <g transform="translate(39,47) scale(0.42)">
              <path
                d="M50 8 C33 30 22 46 22 64 C22 79.46 34.54 92 50 92 C65.46 92 78 79.46 78 64 C78 46 67 30 50 8 Z"
                fill="#E8963C"
              />
            </g>
          </g>
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element -- 벡터 워드마크, next/image svg 최적화 미지원 */}
        <img src="/brand/wordmark.svg" alt="오일픽" className="h-6 w-auto" />
      </h1>
      <p className="text-sm text-muted-foreground">
        경로에 딱 맞는 주유소를 찾아드려요
      </p>

      <HomeMap
        origin={origin}
        destination={destination}
        activeField={activeField}
        onPick={handleMapPick}
      />

      <div className="flex flex-col gap-3">
        <div className="relative rounded-xl border border-input bg-background">
          <PlaceAutocompleteInput
            key={`origin-${resetToken}`}
            label="출발지"
            placeholder="출발지 입력"
            value={origin}
            onChange={setOrigin}
            onFocus={() => setActiveField("origin")}
            bare
          />
          <div className="border-t border-border" />
          <PlaceAutocompleteInput
            key={`destination-${resetToken}`}
            label="목적지"
            placeholder="목적지 입력"
            value={destination}
            onChange={setDestination}
            onFocus={() => setActiveField("destination")}
            bare
          />

          <button
            type="button"
            aria-label="출발지와 목적지 바꾸기"
            onClick={swapOriginDestination}
            className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-[var(--shadow-sm)] transition-transform active:scale-90"
          >
            <ArrowUpDown className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={resetRoute}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            다시입력
          </button>
        </div>

        {tooClose && (
          <p className="text-xs text-destructive">
            출발지와 목적지가 너무 가까워요. 다른 장소를 선택해주세요.
          </p>
        )}

        <FuelSelect value={fuel} onChange={setFuel} />

        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm">
          <span className="flex flex-col">
            고속도로·자동차전용도로 회피
            <span className="text-xs text-muted-foreground">
              통행료가 있는 구간을 피해요. 시간이 더 걸릴 수 있어요
            </span>
          </span>
          <Switch checked={avoidHighway} onCheckedChange={setAvoidHighway} />
        </label>
      </div>

      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={!canSearch}
        onClick={handleSearch}
      >
        찾기
      </Button>

      {recentSearches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            최근 검색
          </h2>
          <ul className="flex flex-col gap-1.5">
            {recentSearches.map((entry, i) => (
              <li key={`${entry.origin.lat}-${entry.destination.lat}-${i}`}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm shadow-[var(--shadow-sm)] transition-all hover:shadow-[var(--shadow-md)] active:scale-[0.98]"
                  onClick={() => applyRecent(entry)}
                >
                  {entry.origin.name ?? "출발지"} →{" "}
                  {entry.destination.name ?? "목적지"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
