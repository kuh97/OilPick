"use client";

/**
 * 결과 목록 (F3·F4·F7) — PRODUCT.md §5.3, ARCHITECTURE.md §10 Phase 9.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CircleSmall, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpDrawer } from "@/components/help-drawer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingProgress } from "@/components/result/loading-progress";
import { ExpansionBanner } from "@/components/result/expansion-banner";
import { ModeTabs } from "@/components/result/mode-tabs";
import { ResultCard } from "@/components/result/result-card";
import { CalcAssumptionsFooter } from "@/components/result/calc-assumptions-footer";
import { FilterSheet } from "@/components/result/filter-sheet";
import { useSearchStore, type ProgressStep } from "@/store/search-store";
import {
  useSearchStream,
  type SearchStreamInput,
} from "@/lib/api/useSearchStream";
import { recomputeAndSort } from "@/lib/recompute-candidates";
import {
  distanceMToKm,
  durationSToMin,
  maxDetourCeilingMinutesForRoutes,
} from "@/domain/pricing";
import type {
  Fuel,
  RefPriceSource,
  WireBaseRoute,
  WireFilters,
  WirePoint,
  WireVehicle,
  WireWarning,
} from "@/app/api/_lib/types";

function WarningBanner({ warning }: { warning: WireWarning }) {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertDescription className="text-warning-foreground">
        {warning.message}
      </AlertDescription>
    </Alert>
  );
}

function SearchRouteSummary({
  origin,
  destination,
  baseRoute,
  referencePrice,
  refPriceSource,
  vehicle,
  onChangeVehicle,
}: {
  origin: WirePoint;
  destination: WirePoint;
  baseRoute: WireBaseRoute;
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  vehicle: WireVehicle;
  onChangeVehicle: (vehicle: Partial<WireVehicle>) => void;
}) {
  const durationMinutes = durationSToMin(baseRoute.durationS);
  const durationLabel =
    durationMinutes >= 60
      ? `약 ${Math.floor(durationMinutes / 60)}시간${durationMinutes % 60 > 0 ? ` ${durationMinutes % 60}분` : ""}`
      : `약 ${durationMinutes}분`;

  return (
    <section
      aria-label="검색 경로"
      className="overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/60"
    >
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] grid-rows-2 items-center gap-y-1.5 px-4 py-3">
        <div className="relative row-span-2 grid grid-rows-subgrid items-center justify-items-center self-stretch">
          <CircleSmall
            className="size-4 fill-background text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <span
            className="absolute top-6.5 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            aria-hidden
          >
            <span className="h-1 w-0.5 rounded-full bg-muted-foreground/45" />
            <span className="h-1 w-0.5 rounded-full bg-muted-foreground/45" />
          </span>
          <MapPin
            className="size-4 fill-background text-primary"
            strokeWidth={2}
            aria-hidden
          />
        </div>
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
          {origin.name ?? "출발지"}
        </p>
        <p className="ml-3 text-right text-sm font-semibold text-foreground tabular-nums">
          약{" "}
          <span className="text-base">
            {distanceMToKm(baseRoute.distanceM)}km
          </span>
        </p>
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
          {destination.name ?? "목적지"}
        </p>
        <p className="ml-3 text-right text-sm text-muted-foreground tabular-nums">
          {durationLabel}
        </p>
      </div>
      <CalcAssumptionsFooter
        compact
        embedded
        referencePrice={referencePrice}
        refPriceSource={refPriceSource}
        vehicle={vehicle}
        onChangeVehicle={onChangeVehicle}
      />
    </section>
  );
}

function DesktopSearchContext({
  origin,
  destination,
  baseRoute,
  referencePrice,
  refPriceSource,
  vehicle,
  onChangeVehicle,
  fuel,
  avoidHighway,
}: {
  origin: WirePoint;
  destination: WirePoint;
  baseRoute: WireBaseRoute | null;
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  vehicle: WireVehicle;
  onChangeVehicle: (vehicle: Partial<WireVehicle>) => void;
  fuel: Fuel;
  avoidHighway: boolean;
}) {
  return (
    <section
      aria-label="검색 경로 및 계산 기준"
      className="overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/60 p-5"
    >
      <h2 className="text-lg font-semibold text-foreground">검색 경로</h2>

      <div className="mt-3 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
        <div className="relative row-span-2 flex flex-col items-center justify-between self-stretch">
          <span
            className="absolute top-3 bottom-3 border-l border-dashed border-muted-foreground/35"
            aria-hidden
          />
          <CircleSmall
            className="relative size-4 fill-background text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <MapPin
            className="relative size-4 fill-background text-primary"
            strokeWidth={2}
            aria-hidden
          />
        </div>
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
          {origin.name ?? "출발지"}
        </p>
        <p className="mt-3 min-w-0 truncate text-sm font-semibold text-foreground">
          {destination.name ?? "목적지"}
        </p>
        {baseRoute && (
          <p className="col-start-2 mt-2 text-sm text-muted-foreground tabular-nums">
            기본 경로 {distanceMToKm(baseRoute.distanceM)}km ·{" "}
            {durationSToMin(baseRoute.durationS)}분
          </p>
        )}
      </div>

      <div className="my-5 border-t border-blue-100" />

      <CalcAssumptionsFooter
        className="border-0 px-0 py-0"
        title="계산 기준"
        referencePrice={referencePrice}
        refPriceSource={refPriceSource}
        vehicle={vehicle}
        onChangeVehicle={onChangeVehicle}
        fuel={fuel}
        avoidHighway={avoidHighway}
      />
    </section>
  );
}

export default function ResultPage() {
  const origin = useSearchStore((s) => s.origin);
  const destination = useSearchStore((s) => s.destination);
  const fuel = useSearchStore((s) => s.fuel);
  const filters = useSearchStore((s) => s.filters);
  const avoidHighway = useSearchStore((s) => s.avoidHighway);
  const vehicle = useSearchStore((s) => s.vehicle);
  const maxDetourMinutes = useSearchStore((s) => s.maxDetourMinutes);
  const mode = useSearchStore((s) => s.mode);
  const setFilters = useSearchStore((s) => s.setFilters);
  const setVehicle = useSearchStore((s) => s.setVehicle);
  const setMaxDetourMinutes = useSearchStore((s) => s.setMaxDetourMinutes);
  const setMode = useSearchStore((s) => s.setMode);
  const detourIntent = useSearchStore((s) => s.detourIntent);
  const setDetourIntent = useSearchStore((s) => s.setDetourIntent);

  const isLoading = useSearchStore((s) => s.isLoading);
  const isJsonFallback = useSearchStore((s) => s.isJsonFallback);
  const progressStep = useSearchStore((s) => s.progressStep);
  const progressStepsSeen = useSearchStore((s) => s.progressStepsSeen);
  const expandRadiusM = useSearchStore((s) => s.expandRadiusM);
  const baseRoute = useSearchStore((s) => s.baseRoute);
  const partial = useSearchStore((s) => s.partial);
  const result = useSearchStore((s) => s.result);
  const streamWarnings = useSearchStore((s) => s.streamWarnings);
  const error = useSearchStore((s) => s.error);

  const { search } = useSearchStream();

  // progressStep/expandRadiusM은 결과 도착 시 store가 null로 비운다(setResult) — 그런데
  // 완료 직후 잠깐(아래 settling) 마지막 단계가 채워진 모습을 보여줘야 하므로, 비워지기
  // 직전의 값을 렌더링 중 상태 조정 패턴(React 공식 권장 — place-autocomplete.tsx와 동일)
  // 으로 붙잡아둔다. useRef로 만들면 렌더 중 ref.current를 읽게 돼 린트 규칙에 걸린다.
  const [lastStep, setLastStep] = useState<ProgressStep>("ROUTE");
  if (progressStep && progressStep !== lastStep) setLastStep(progressStep);
  const [lastJsonFallback, setLastJsonFallback] = useState(false);
  if (isLoading && isJsonFallback !== lastJsonFallback)
    setLastJsonFallback(isJsonFallback);
  const [lastRadiusM, setLastRadiusM] = useState<number | undefined>(undefined);
  if (expandRadiusM != null && expandRadiusM !== lastRadiusM)
    setLastRadiusM(expandRadiusM);

  // 검색이 끝나는 순간(마지막 단계 → 결과) 로딩 화면이 너무 순식간에 사라지면 사용자가
  // 진행 과정을 못 본다 — 결과가 도착해도 잠깐(500ms) 마지막 단계가 다 채워진 모습을
  // 보여준 뒤에 결과 화면으로 넘어간다. 로딩 중엔 항상 이 풀스크린 하나만 쓰고,
  // 결과가 부분적으로 왔다고 작은 인라인 바로 축소하지 않는다("풀 → 인라인 전환이
  // 어색하다"는 피드백에 따른 결정). isLoading이 막 꺼진 순간만 잡아야 하므로 이전 값과의
  // 비교도 렌더 중 상태 조정으로 하고, useEffect는 타이머 예약만 한다(본문에서 직접
  // setState하지 않음 — react-hooks/set-state-in-effect).
  const [wasLoading, setWasLoading] = useState(isLoading);
  const [settling, setSettling] = useState(false);
  if (isLoading !== wasLoading) {
    setWasLoading(isLoading);
    if (wasLoading && !isLoading && result) setSettling(true);
    if (!wasLoading && isLoading) {
      setLastRadiusM(undefined);
      setSettling(false);
    }
  }

  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), 500);
    return () => clearTimeout(timer);
  }, [settling]);

  // 새 경로는 STAGE 1부터.
  const routeKey = JSON.stringify({ origin, destination });
  const previousRouteKeyRef = useRef(routeKey);

  function runSearch(detour: { maxDetourMinutes: number } | null) {
    if (!origin || !destination) return;
    const body: SearchStreamInput = {
      origin,
      destination,
      fuel,
      filters,
      vehicle: useSearchStore.getState().vehicle,
      mode: useSearchStore.getState().mode,
      avoidHighway,
      includeDetour: detour != null,
      maxDetourMinutes: detour?.maxDetourMinutes,
    };
    void search(body);
  }

  // 재검색 트리거는 이 한 곳뿐 — 필터·우회 시간을 같이 바꿔도 검색은 한 번만 나간다 (불변식 8).
  // vehicle·mode는 클라이언트 재계산만 하므로 제외. lastSearchKey는 스토어에 둬서
  // 상세→뒤로가기 리마운트 후에도 같은 조건이면 재검색을 건너뛴다.
  useEffect(() => {
    if (!origin || !destination) return;
    const routeChanged = previousRouteKeyRef.current !== routeKey;
    if (routeChanged) {
      // 외부 Zustand 스토어는 렌더 중 갱신하지 않고 effect에서 초기화한다.
      previousRouteKeyRef.current = routeKey;
      setDetourIntent(null);
    }
    // 새 경로의 첫 검색은 이전 경로의 우회 의도를 물려받지 않는다.
    const detourIntentForSearch = routeChanged ? null : detourIntent;
    const key = JSON.stringify({
      origin,
      destination,
      fuel,
      filters,
      avoidHighway,
      detourIntent: detourIntentForSearch,
    });
    if (useSearchStore.getState().lastSearchKey === key) return;
    useSearchStore.getState().setLastSearchKey(key);
    runSearch(detourIntentForSearch);
    return () => {
      // 진행 중인 요청은 훅 정리에서 취소된다. StrictMode 재실행·재진입 시 다시 검색할 수 있게 한다.
      const state = useSearchStore.getState();
      if (state.isLoading && state.lastSearchKey === key)
        state.setLastSearchKey(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    origin,
    destination,
    fuel,
    filters,
    avoidHighway,
    detourIntent,
    routeKey,
  ]);

  const referencePrice =
    result?.referencePrice ?? partial?.referencePrice ?? null;
  const refPriceSource =
    result?.refPriceSource ?? partial?.refPriceSource ?? null;
  const expansion = result?.expansion ?? partial?.expansion ?? null;

  const displayCandidates = useMemo(() => {
    const rawCandidates = result?.candidates ?? partial?.candidates ?? [];
    return recomputeAndSort(rawCandidates, vehicle, referencePrice, mode);
  }, [result, partial, vehicle, referencePrice, mode]);

  // 어느 비교 경로에서든 경로상 후보가 있으면 우회 시간은 적용 대상이 아니다.
  const isOnRouteStage = result?.stage === "ON_ROUTE";

  const hasActiveFilters =
    filters.facilities.length > 0 ||
    filters.brands.length > 0 ||
    filters.kpetroOnly ||
    filters.selfOnly;
  // 우회 허용 시간이 검색 파라미터라 클라이언트엔 걸러진 후보가 없다 → 서버가 담아 준다 (§5.3).
  const minutesNeededForOneResult = result?.minutesNeededForOneResult ?? null;
  const resultRoutes = result?.baseRoutes?.map(({ route }) => route);
  const partialRoutes = partial?.baseRoutes?.map(({ route }) => route);
  const routesForDetourCeiling =
    resultRoutes && resultRoutes.length > 0
      ? resultRoutes
      : partialRoutes && partialRoutes.length > 0
        ? partialRoutes
        : baseRoute
          ? [baseRoute]
          : [];
  const maxDetourCeiling =
    routesForDetourCeiling.length > 0
      ? maxDetourCeilingMinutesForRoutes(routesForDetourCeiling)
      : 30;
  const canRelaxMaxDetour =
    minutesNeededForOneResult != null &&
    minutesNeededForOneResult <= maxDetourCeiling;
  const defaultFilters: WireFilters = {
    facilities: [],
    brands: [],
    kpetroOnly: false,
    selfOnly: false,
  };

  if (!origin || !destination) {
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

  if (error) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            render={<Link href="/home" />}
            nativeButton={false}
          >
            홈으로
          </Button>
          <Button
            onClick={() => {
              const key = JSON.stringify({
                origin,
                destination,
                fuel,
                filters,
                avoidHighway,
                detourIntent,
              });
              useSearchStore.getState().setLastSearchKey(key);
              runSearch(detourIntent);
            }}
          >
            다시 시도
          </Button>
        </div>
      </main>
    );
  }

  const showFullScreenLoading = isLoading || settling;

  function renderFilterSheet() {
    if (isOnRouteStage) {
      return (
        <FilterSheet
          filters={filters}
          onApply={setFilters}
          includeDetour={false}
        />
      );
    }

    return (
      <FilterSheet
        filters={filters}
        onApply={setFilters}
        maxDetourMinutes={maxDetourMinutes}
        maxDetourCeiling={maxDetourCeiling}
        onApplyMaxDetourMinutes={(minutes) => {
          setMaxDetourMinutes(minutes);
          setDetourIntent({ maxDetourMinutes: minutes });
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6 md:max-w-6xl md:gap-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/home"
            className="min-w-0 truncate text-sm text-muted-foreground"
          >
            <span className="md:hidden">← 홈</span>
            <span className="hidden md:inline">← 홈으로</span>
          </Link>
          {!showFullScreenLoading && (
            <HelpDrawer
              feedbackSource="SEARCH"
              searchId={result?.searchId}
              originName={origin.name}
              destinationName={destination.name}
            />
          )}
        </div>
        {!showFullScreenLoading && (result?.baseRoute ?? baseRoute) && (
          <div className="md:hidden">
            <SearchRouteSummary
              origin={origin}
              destination={destination}
              baseRoute={(result?.baseRoute ?? baseRoute)!}
              referencePrice={referencePrice}
              refPriceSource={refPriceSource}
              vehicle={vehicle}
              onChangeVehicle={setVehicle}
            />
          </div>
        )}
      </header>

      {showFullScreenLoading ? (
        <LoadingProgress
          currentStep={progressStep ?? lastStep}
          stepsSeen={progressStepsSeen}
          expandRadiusM={expandRadiusM ?? lastRadiusM}
          isJsonFallback={isLoading ? isJsonFallback : lastJsonFallback}
          completed={settling}
        />
      ) : (
        <>
          <div className="md:grid md:grid-cols-[clamp(280px,30vw,340px)_minmax(0,1fr)] md:items-start md:gap-6">
            <aside className="hidden flex-col gap-4 md:sticky md:top-6 md:flex">
              <DesktopSearchContext
                origin={origin}
                destination={destination}
                baseRoute={result?.baseRoute ?? baseRoute}
                referencePrice={referencePrice}
                refPriceSource={refPriceSource}
                vehicle={vehicle}
                onChangeVehicle={setVehicle}
                fuel={fuel}
                avoidHighway={avoidHighway}
              />
            </aside>

            <section className="flex min-w-0 flex-col gap-4">
              {expansion && (
                <ExpansionBanner expansion={expansion} fuel={fuel} />
              )}
              {(result?.warnings ?? streamWarnings)
                .filter((w) => w.code === "TIMEOUT")
                .map((w, i) => (
                  <WarningBanner key={`${w.code}-${i}`} warning={w} />
                ))}

              <div className="flex items-center justify-between gap-2">
                <ModeTabs value={mode} onChange={setMode} />
                {renderFilterSheet()}
              </div>

              {displayCandidates.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
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
                  ) : minutesNeededForOneResult != null ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        우회 허용 시간({maxDetourMinutes}분) 안에 드는 주유소가
                        없습니다.
                      </p>
                      {canRelaxMaxDetour ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setMaxDetourMinutes(minutesNeededForOneResult);
                            setDetourIntent({
                              maxDetourMinutes: minutesNeededForOneResult,
                            });
                          }}
                        >
                          우회 허용 시간을 {minutesNeededForOneResult}분으로
                          늘리기
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          허용 시간을 최대({maxDetourCeiling}분)로 늘려도 이
                          경로에는 조건에 맞는 주유소가 없습니다.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        이 경로에서는 조건에 맞는 주유소를 찾지 못했습니다.
                      </p>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          render={<Link href="/home" />}
                          nativeButton={false}
                        >
                          다른 경로로 다시 찾기
                        </Button>
                        <Button
                          variant="outline"
                          render={<Link href="/nearby" />}
                          nativeButton={false}
                        >
                          현재 위치 주변에서 찾기
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <ul className="flex flex-col gap-2 md:gap-3">
                  {displayCandidates.map((c, i) => (
                    <li key={c.id}>
                      <ResultCard
                        rank={i + 1}
                        candidate={c}
                        referencePrice={referencePrice}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
