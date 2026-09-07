"use client";

/**
 * 결과 목록 (F3·F4·F7) — PRODUCT.md §5.3, ARCHITECTURE.md §10 Phase 9.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingProgress } from "@/components/result/loading-progress";
import { ExpansionBanner } from "@/components/result/expansion-banner";
import { ModeTabs } from "@/components/result/mode-tabs";
import { ResultCard } from "@/components/result/result-card";
import { CalcAssumptionsFooter } from "@/components/result/calc-assumptions-footer";
import { FilterSheet } from "@/components/result/filter-sheet";
import { useSearchStore, type ProgressStep } from "@/store/search-store";
import { useSearchStream, type SearchStreamInput } from "@/lib/api/useSearchStream";
import { recomputeAndSort } from "@/lib/recompute-candidates";
import { distanceMToKm, durationSToMin } from "@/domain/pricing";
import type { WireFilters, WireWarning } from "@/app/api/_lib/types";

function WarningBanner({ warning }: { warning: WireWarning }) {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertDescription className="text-warning-foreground">{warning.message}</AlertDescription>
    </Alert>
  );
}

/**
 * 시설 필터가 켜졌을 때의 커버리지 고지 — docs/MIGRATION-DB.md §9.3.
 * 시설 정보는 상세 API 백필(§7 Phase E, 무인 ~34일)로 채워지는 중이라, 필터를 걸면
 * 아직 확인 안 된 주유소가 통째로 빠진다. 결과가 적은 게 데이터 커버리지 때문임을
 * 알린다. 백필이 끝나면 이 배너와 호출부를 함께 제거한다.
 */
function FacilityCoverageBanner() {
  return (
    <Alert variant="info">
      <Info aria-hidden />
      <AlertDescription className="text-info-foreground">
        시설 정보가 확인된 주유소만 표시돼요. 데이터 보강이 진행 중이라 실제로는 더 많을 수 있어요.
      </AlertDescription>
    </Alert>
  );
}

export default function ResultPage() {
  const origin = useSearchStore((s) => s.origin);
  const destination = useSearchStore((s) => s.destination);
  const fuel = useSearchStore((s) => s.fuel);
  const filters = useSearchStore((s) => s.filters);
  const vehicle = useSearchStore((s) => s.vehicle);
  const mode = useSearchStore((s) => s.mode);
  const setFilters = useSearchStore((s) => s.setFilters);
  const setVehicle = useSearchStore((s) => s.setVehicle);
  const setMode = useSearchStore((s) => s.setMode);

  const isLoading = useSearchStore((s) => s.isLoading);
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
  const [lastRadiusM, setLastRadiusM] = useState<number | undefined>(undefined);
  if (expandRadiusM != null && expandRadiusM !== lastRadiusM) setLastRadiusM(expandRadiusM);

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
    if (!wasLoading && isLoading) setLastRadiusM(undefined); // 새 검색 시작 — 이전 검색의 확장 반경을 들고 있지 않게
  }

  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), 500);
    return () => clearTimeout(timer);
  }, [settling]);

  function runSearch(input: { origin: NonNullable<typeof origin>; destination: NonNullable<typeof destination> }) {
    const body: SearchStreamInput = {
      origin: input.origin,
      destination: input.destination,
      fuel,
      filters,
      vehicle: useSearchStore.getState().vehicle,
      mode: useSearchStore.getState().mode,
    };
    void search(body);
  }

  // 출발지·목적지·연료·필터가 바뀌면 다시 검색한다. vehicle·mode는 클라이언트 재계산만
  // 하므로 의도적으로 의존성에서 뺐다(§10 Phase 9 완료 기준 — API 재호출 0회).
  //
  // "마지막으로 검색한 조건"은 컴포넌트 로컬(useRef)이 아니라 스토어에 둔다 — 상세보기
  // 갔다가 뒤로가기하면 이 페이지 컴포넌트가 리마운트되어 로컬 ref는 초기화되지만,
  // 스토어의 result·lastSearchKey는 그대로 남아있으므로 같은 조건이면 재검색을 건너뛴다.
  useEffect(() => {
    if (!origin || !destination) return;
    const key = JSON.stringify({ origin, destination, fuel, filters });
    if (useSearchStore.getState().lastSearchKey === key) return;
    useSearchStore.getState().setLastSearchKey(key);
    runSearch({ origin, destination });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, fuel, filters]);

  const referencePrice = result?.referencePrice ?? partial?.referencePrice ?? null;
  const expansion = result?.expansion ?? partial?.expansion ?? null;

  const displayCandidates = useMemo(() => {
    const rawCandidates = result?.candidates ?? partial?.candidates ?? [];
    return recomputeAndSort(rawCandidates, vehicle, referencePrice, mode);
  }, [result, partial, vehicle, referencePrice, mode]);

  const hasActiveFilters =
    filters.facilities.length > 0 ||
    filters.brands.length > 0 ||
    filters.kpetroOnly ||
    filters.selfOnly;
  const defaultFilters: WireFilters = {
    facilities: [],
    brands: [],
    kpetroOnly: false,
    selfOnly: false,
  };

  if (!origin || !destination) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">검색 컨텍스트가 없습니다. 홈에서 먼저 검색해주세요.</p>
        <Button render={<Link href="/home" />} nativeButton={false}>홈으로</Button>
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
            render={<Link href="/home" onClick={() => useSearchStore.getState().clearRoute()} />}
            nativeButton={false}
          >
            홈으로
          </Button>
          <Button
            onClick={() => {
              const key = JSON.stringify({ origin, destination, fuel, filters });
              useSearchStore.getState().setLastSearchKey(key);
              runSearch({ origin, destination });
            }}
          >
            다시 시도
          </Button>
        </div>
      </main>
    );
  }

  const showFullScreenLoading = isLoading || settling;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/home"
          className="text-sm text-muted-foreground"
          onClick={() => useSearchStore.getState().clearRoute()}
        >
          ← {origin.name ?? "출발지"} → {destination.name ?? "목적지"}
        </Link>
        {(result?.baseRoute ?? baseRoute) && (
          <p className="text-sm text-muted-foreground">
            기본 경로 {distanceMToKm((result?.baseRoute ?? baseRoute)!.distanceM)}km ·{" "}
            {durationSToMin((result?.baseRoute ?? baseRoute)!.durationS)}분
          </p>
        )}
      </header>

      {showFullScreenLoading ? (
        <LoadingProgress
          currentStep={progressStep ?? lastStep}
          stepsSeen={progressStepsSeen}
          expandRadiusM={expandRadiusM ?? lastRadiusM}
        />
      ) : (
        <>
          {expansion && <ExpansionBanner expansion={expansion} fuel={fuel} />}
          {(result?.warnings ?? streamWarnings).map((w, i) => (
            <WarningBanner key={`${w.code}-${i}`} warning={w} />
          ))}
          {filters.facilities.length > 0 && <FacilityCoverageBanner />}

          <div className="flex items-center justify-between gap-2">
            <ModeTabs value={mode} onChange={setMode} />
            <FilterSheet filters={filters} onApply={setFilters} />
          </div>

          {displayCandidates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              {hasActiveFilters ? (
                <>
                  <p className="text-sm text-muted-foreground">선택하신 필터 조건에 맞는 주유소가 없습니다.</p>
                  <Button variant="outline" onClick={() => setFilters(defaultFilters)}>
                    필터 초기화하고 다시 찾기
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">이 경로에서는 조건에 맞는 주유소를 찾지 못했습니다.</p>
                  <Button
                    variant="outline"
                    render={<Link href="/home" onClick={() => useSearchStore.getState().clearRoute()} />}
                    nativeButton={false}
                  >
                    다른 경로로 다시 찾기
                  </Button>
                </>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {displayCandidates.map((c, i) => (
                <li key={c.id}>
                  <ResultCard rank={i + 1} candidate={c} referencePrice={referencePrice} />
                </li>
              ))}
            </ul>
          )}

          {result && (
            <CalcAssumptionsFooter
              referencePrice={result.referencePrice}
              refPriceSource={result.refPriceSource}
              vehicle={vehicle}
              onChangeVehicle={setVehicle}
            />
          )}
        </>
      )}
    </main>
  );
}
