"use client";

/**
 * 홈 (F1) — 경로 입력. PRODUCT.md §5.1, ARCHITECTURE.md §10 Phase 9.
 */

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpDrawer } from "@/components/help-drawer";
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
    useSearchStore.getState().setDetourIntent(null);
    router.push("/result");
  }

  function applyRecent(entry: (typeof recentSearches)[number]) {
    setOrigin(entry.origin);
    setDestination(entry.destination);
    setFuel(entry.fuel);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8 md:max-w-6xl md:gap-8 md:px-8 md:py-10">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2">
          <Image src="/icon.svg" width={32} height={32} alt="" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element -- 벡터 워드마크, next/image svg 최적화 미지원 */}
          <img
            src="/brand/wordmark.svg"
            width={290}
            height={116}
            alt="오일픽"
            className="h-6 w-auto"
          />
        </h1>
        <HelpDrawer feedbackSource="HOME" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          경로에 딱 맞는 주유소를 찾아드려요
        </h2>
        <p className="text-sm text-muted-foreground md:text-base">
          가는 길에 없다면, 돌아갈 가치가 있는 곳까지 살펴봐요.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] md:items-start">
        <div className="order-last flex flex-col gap-4 md:order-none">
          <section className="flex flex-col gap-6 md:rounded-xl md:border md:border-border md:bg-card md:p-5 md:shadow-[var(--shadow-sm)]">
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

            <Link href="/nearby" className="text-center text-sm text-primary hover:underline">
              내 주변 주유소 보기
            </Link>
          </section>

          {recentSearches.length > 0 && (
            <section className="flex flex-col gap-2 md:rounded-xl md:border md:border-border md:bg-card md:p-5 md:shadow-[var(--shadow-sm)]">
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
            </section>
          )}
        </div>

        <section className="order-first md:order-none md:sticky md:top-6 md:rounded-xl md:border md:border-border md:bg-card md:p-3 md:shadow-[var(--shadow-sm)]">
          <HomeMap
            origin={origin}
            destination={destination}
            activeField={activeField}
            onPick={handleMapPick}
            className="h-48 md:aspect-auto md:h-[clamp(560px,42vw,680px)]"
          />
        </section>
      </div>
    </main>
  );
}
