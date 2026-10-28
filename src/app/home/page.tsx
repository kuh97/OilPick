"use client";

/**
 * 홈 (F1) — 경로 입력. PRODUCT.md §5.1, ARCHITECTURE.md §10 Phase 9.
 */

import { useLayoutEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronRight,
  CircleSmall,
  History as HistoryIcon,
  MapPin,
  MapPinned,
  RotateCcw,
  Route as RouteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpDrawer } from "@/components/help-drawer";
import { Switch } from "@/components/ui/switch";
import { PlaceAutocompleteInput } from "@/components/place-autocomplete";
import { FuelSelect } from "@/components/fuel-select";
import { HomeMap, type HomeMapField } from "@/components/home-map";
import { CalcAssumptionsFooter } from "@/components/result/calc-assumptions-footer";
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
  const vehicle = useSearchStore((s) => s.vehicle);
  const avoidHighway = useSearchStore((s) => s.avoidHighway);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const setOrigin = useSearchStore((s) => s.setOrigin);
  const setDestination = useSearchStore((s) => s.setDestination);
  const setFuel = useSearchStore((s) => s.setFuel);
  const setVehicle = useSearchStore((s) => s.setVehicle);
  const setAvoidHighway = useSearchStore((s) => s.setAvoidHighway);
  const clearRoute = useSearchStore((s) => s.clearRoute);

  // 결과 화면에서 홈으로 이동할 때는 홈이 마운트된 뒤 휘발성 경로를 비운다.
  // 결과 페이지의 Link 클릭 시 먼저 비우면 결과 페이지가 잠깐 "검색 컨텍스트 없음"
  // 상태로 다시 렌더링되는 문제가 생긴다.
  useLayoutEffect(() => {
    clearRoute();
  }, [clearRoute]);

  const [activeField, setActiveField] = useState<HomeMapField>("origin");
  // "다시 입력"을 누르면 입력창에 남아있는 편집 중 텍스트(아직 좌표로 확정 안 된 상태 —
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-7 px-4 py-7 md:max-w-6xl md:gap-8 md:px-8 md:py-10">
      <div className="flex items-center justify-between gap-4">
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
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-text-strong md:text-3xl">
          출발지와 목적지만 입력하세요
        </h2>
        <p className="text-sm leading-6 text-text-body md:text-base">
          가는 길에 있는 주유소부터, 조금 돌아가도 괜찮은 곳까지 찾아드려요.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] md:items-start md:gap-6">
        <div className="order-last flex flex-col gap-3 md:order-none">
          <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-route-sm md:p-5">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2">
                <div className="relative overflow-visible rounded-card border border-input bg-surface">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-6 left-5 top-6 z-10 border-l border-dashed border-route-cyan/70"
                  />
                  <PlaceAutocompleteInput
                    key={`origin-${resetToken}`}
                    label="출발지"
                    placeholder="출발지 입력"
                    value={origin}
                    onChange={setOrigin}
                    onFocus={() => setActiveField("origin")}
                    leadingIcon={
                      <CircleSmall
                        className="size-4"
                        strokeWidth={2}
                        aria-hidden
                      />
                    }
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
                    leadingIcon={
                      <MapPin className="size-4" strokeWidth={2} aria-hidden />
                    }
                    bare
                  />
                </div>

                <div className="grid grid-rows-2 items-center gap-1">
                  <button
                    type="button"
                    aria-label="출발지와 목적지 바꾸기"
                    onClick={swapOriginDestination}
                    className="flex size-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-route-sky hover:text-route-strong active:scale-95"
                  >
                    <ArrowUpDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="출발지와 목적지 다시 입력"
                    title="다시 입력"
                    onClick={resetRoute}
                    className="flex size-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-route-sky hover:text-route-strong active:scale-95"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>

              {tooClose && (
                <p className="text-xs text-destructive">
                  출발지와 목적지가 너무 가까워요. 다른 장소를 선택해주세요.
                </p>
              )}

              <FuelSelect value={fuel} onChange={setFuel} />

              <div className="flex flex-col gap-0.5">
                <CalcAssumptionsFooter
                  compact
                  embedded
                  embeddedDivider={false}
                  embeddedInset={false}
                  referencePrice={null}
                  refPriceSource={null}
                  vehicle={vehicle}
                  onChangeVehicle={setVehicle}
                />

                <label className="flex items-center justify-between gap-3 px-0 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center">
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      <RouteIcon
                        className="size-3.5 text-muted-foreground"
                        aria-hidden
                      />
                    </span>
                    <span className="min-w-0">
                      고속도로·자동차전용도로 제외
                    </span>
                  </span>
                  <Switch
                    checked={avoidHighway}
                    onCheckedChange={setAvoidHighway}
                  />
                </label>
              </div>
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
          </section>

          <Link
            href="/nearby"
            className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-route-sky bg-surface px-4 py-3 text-left shadow-route-sm transition-colors hover:bg-route-sky active:scale-[0.99]"
          >
            <span className="flex min-w-0 items-start gap-2.5">
              <MapPinned
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  현재 위치 주변 주유소 찾기
                </span>
                <span className="text-xs text-muted-foreground">
                  지금 있는 곳을 기준으로 가까운 주유소를 찾아요.
                </span>
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>

          {recentSearches.length > 0 && (
            <section
              aria-label="최근 검색"
              className="min-w-0 max-w-full overflow-hidden rounded-card border border-border bg-surface shadow-route-sm"
            >
              <ul className="min-w-0 divide-y divide-border">
                {recentSearches.map((entry, i) => (
                  <li
                    key={`${entry.origin.lat}-${entry.destination.lat}-${i}`}
                    className="min-w-0"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 max-w-full w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 active:bg-muted/60"
                      onClick={() => applyRecent(entry)}
                    >
                      <HistoryIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
                        {entry.origin.name ?? "출발지"} →{" "}
                        {entry.destination.name ?? "목적지"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section
          aria-label="경로 지도"
          className="order-first rounded-card border border-border bg-surface p-3 shadow-route-sm md:order-none md:sticky md:top-6"
        >
          <HomeMap
            origin={origin}
            destination={destination}
            activeField={activeField}
            onPick={handleMapPick}
            className="h-48 md:h-[630px] md:max-h-[630px]"
          />
        </section>
      </div>
    </main>
  );
}
