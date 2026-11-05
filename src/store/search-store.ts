/**
 * 검색 컨텍스트 — Zustand. PRODUCT.md §5.1(최근 검색)·§9.2(계산 전제 기본값),
 * ARCHITECTURE.md §2(store/search-store.ts).
 *
 * vehicle·recentSearches만 persist합니다 — origin/destination/nearbyOrigin/result는 화면을
 * 벗어나면 다시 검색하는 게 맞는 휘발성 상태입니다(스토어가 빈 채로 /station/:id에
 * 직접 진입하면 "검색 컨텍스트 없음"을 보여주는 것도 이 휘발성 전제 위에 섭니다).
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  DEFAULT_EFFICIENCY,
  DEFAULT_REFUEL_AMOUNT,
  V_TIME,
  DEFAULT_MAX_DETOUR_DISTANCE_KM,
} from "@/domain/params";
import type {
  Fuel,
  Mode,
  WireFilters,
  WireVehicle,
  WirePoint,
  WireBaseRoute,
  WirePartial,
  WireSearchResult,
  WireWarning,
} from "@/app/api/_lib/types";

export type ProgressStep = "ROUTE" | "COLLECT" | "EXPAND" | "PRECISE";

export interface RecentSearch {
  origin: WirePoint;
  destination: WirePoint;
  fuel: Fuel;
  searchedAt: string; // ISO8601
}

const MAX_RECENT_SEARCHES = 3;

const DEFAULT_FILTERS: WireFilters = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };

function defaultVehicleFor(fuel: Fuel): WireVehicle {
  return {
    efficiency: DEFAULT_EFFICIENCY[fuel],
    refuelAmount: DEFAULT_REFUEL_AMOUNT,
    timeValue: V_TIME,
  };
}

interface SearchState {
  // ─── F1 입력 ───────────────────────────────────────────────────────────
  origin: WirePoint | null;
  destination: WirePoint | null;
  /** 내 주변 화면에서 상세로 전달할 현재 위치 — 정확한 좌표를 URL·localStorage에 저장하지 않는 휘발성 상태 */
  nearbyOrigin: WirePoint | null;
  fuel: Fuel;
  filters: WireFilters;
  vehicle: WireVehicle; // persist — 사용자가 연비·주유량을 수정하면 다음 검색에도 유지
  /** 연비를 사용자가 직접 고쳐둔 상태인지 — true면 연료를 바꿔도 연비를 덮어쓰지 않는다.
   * "현재 연료의 기본 연비와 다른가"로 판정하므로, 기본값으로 되돌리면 다시 자동 추종한다. */
  efficiencyTouched: boolean;
  /** 사용자가 현재 경로에서 허용하는 최대 우회 거리(km) — 새 경로에서는 기본값으로 시작한다. */
  maxDetourDistanceKm: number;
  mode: Mode;
  /**
   * 고속도로·자동차전용도로 회피 — persist(홈 화면 설정, `fuel`과 같은 부류). `filters`와
   * 마찬가지로 바뀌면 재검색해야 한다 — 후보를 거르는 게 아니라 경로 자체(baseRoute)를
   * 바꾸는 검색 조건이기 때문이다 (PRODUCT.md §5.1).
   */
  avoidHighway: boolean;
  /** 결과 화면에서 사용자가 우회 탐색을 요청했는지 — 상세→뒤로가기에서도 유지해야 하는 휘발성 상태 */
  detourIntent: { maxDetourDistanceKm: number } | null;

  // ─── 검색 진행 상태 (휘발성) ───────────────────────────────────────────
  isLoading: boolean;
  /** 첫 SSE 이벤트가 오지 않아 JSON 폴백 중이면 실제 단계 여부를 단정하지 않는다. */
  isJsonFallback: boolean;
  progressStep: ProgressStep | null;
  /** 실제로 거쳐간 단계만 누적 — STAGE 2에 진입하지 않으면 EXPAND를 건너뛰므로, 순서상
   * 지나간 것으로 잘못 표시하지 않으려면 인덱스 비교가 아니라 이 집합으로 판정해야 한다. */
  progressStepsSeen: ProgressStep[];
  /** EXPAND 단계에서 서버가 보고한 탐색 상한(m) — 진행 이벤트 진단·후속 시각화용 */
  expandRadiusM: number | null;
  /** STEP 1 직후 도착 — result 전에 헤더·지도를 먼저 그리는 용도 (§6.2) */
  baseRoute: WireBaseRoute | null;
  /** result 도착 전 카드 프리뷰용. Kakao 최종 확인 전이라 detour.precise===false (§6.2) */
  partial: WirePartial | null;
  result: WireSearchResult | null;
  streamWarnings: WireWarning[]; // 스트림 도중 받은 warning 누적 (result 전 표시용)
  error: { code: string; message: string } | null;
  /** 마지막으로 검색을 시작한 origin/destination/fuel/filters 조합의 키 — result 화면이
   * 상세보기→뒤로가기로 리마운트돼도(로컬 ref는 초기화됨) 같은 조건이면 재검색하지
   * 않도록, 컴포넌트 수명을 넘어 살아있는 스토어에 둔다. */
  lastSearchKey: string | null;

  // ─── 최근 검색 (persist) ───────────────────────────────────────────────
  recentSearches: RecentSearch[];

  // ─── actions ───────────────────────────────────────────────────────────
  setOrigin: (p: WirePoint | null) => void;
  setDestination: (p: WirePoint | null) => void;
  setNearbyOrigin: (p: WirePoint | null) => void;
  setFuel: (fuel: Fuel) => void;
  setFilters: (filters: WireFilters) => void;
  setVehicle: (vehicle: Partial<WireVehicle>) => void;
  setMaxDetourDistanceKm: (distanceKm: number) => void;
  setMode: (mode: Mode) => void;
  setAvoidHighway: (avoid: boolean) => void;
  setDetourIntent: (intent: { maxDetourDistanceKm: number } | null) => void;

  startSearch: () => void;
  setJsonFallback: (value: boolean) => void;
  setProgressStep: (step: ProgressStep, radiusM?: number) => void;
  setBaseRoute: (baseRoute: WireBaseRoute) => void;
  setPartial: (partial: WirePartial) => void;
  pushWarning: (warning: WireWarning) => void;
  setResult: (result: WireSearchResult) => void;
  setError: (error: { code: string; message: string }) => void;
  setLastSearchKey: (key: string | null) => void;

  addRecentSearch: (entry: Omit<RecentSearch, "searchedAt">) => void;
  reset: () => void;
  clearRoute: () => void;
}

/** localStorage가 막혀 있어도(프라이빗 모드) 조용히 메모리로 폴백 — PRODUCT.md §10.2 */
function safeStorage(): StateStorage {
  const memory = new Map<string, string>();
  const hasWindow = typeof window !== "undefined";
  return {
    getItem: (name) => {
      try {
        return hasWindow ? window.localStorage.getItem(name) : (memory.get(name) ?? null);
      } catch {
        return memory.get(name) ?? null;
      }
    },
    setItem: (name, value) => {
      try {
        if (hasWindow) window.localStorage.setItem(name, value);
        else memory.set(name, value);
      } catch {
        memory.set(name, value);
      }
    },
    removeItem: (name) => {
      try {
        if (hasWindow) window.localStorage.removeItem(name);
        else memory.delete(name);
      } catch {
        memory.delete(name);
      }
    },
  };
}

type PersistedState = Pick<SearchState, "vehicle" | "efficiencyTouched" | "recentSearches" | "fuel" | "avoidHighway">;
type LegacyPersistedState = Partial<PersistedState> & { maxDetourDistanceKm?: number };

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      origin: null,
      destination: null,
      nearbyOrigin: null,
      fuel: "GASOLINE",
      filters: DEFAULT_FILTERS,
      vehicle: defaultVehicleFor("GASOLINE"),
      efficiencyTouched: false,
      maxDetourDistanceKm: DEFAULT_MAX_DETOUR_DISTANCE_KM,
      mode: "balanced",
      avoidHighway: false,
      detourIntent: null,

      isLoading: false,
      isJsonFallback: false,
      progressStep: null,
      progressStepsSeen: [],
      expandRadiusM: null,
      baseRoute: null,
      partial: null,
      result: null,
      streamWarnings: [],
      error: null,
      lastSearchKey: null,

      recentSearches: [],

      setOrigin: (p) =>
        set({
          origin: p,
          nearbyOrigin: null,
          maxDetourDistanceKm: DEFAULT_MAX_DETOUR_DISTANCE_KM,
          detourIntent: null,
        }),
      setDestination: (p) =>
        set({
          destination: p,
          nearbyOrigin: null,
          maxDetourDistanceKm: DEFAULT_MAX_DETOUR_DISTANCE_KM,
          detourIntent: null,
        }),
      setNearbyOrigin: (p) => set({ nearbyOrigin: p }),
      setFuel: (fuel) =>
        set((s) => ({
          fuel,
          vehicle: s.efficiencyTouched ? s.vehicle : { ...s.vehicle, efficiency: DEFAULT_EFFICIENCY[fuel] },
        })),
      setFilters: (filters) => set({ filters }),
      setVehicle: (vehicle) => {
        const next = { ...get().vehicle, ...vehicle };
        set({ vehicle: next, efficiencyTouched: next.efficiency !== DEFAULT_EFFICIENCY[get().fuel] });
      },
      setMaxDetourDistanceKm: (distanceKm) => set({ maxDetourDistanceKm: distanceKm }),
      setMode: (mode) => set({ mode }),
      setAvoidHighway: (avoid) => set({ avoidHighway: avoid }),
      setDetourIntent: (intent) => set({ detourIntent: intent }),

      startSearch: () =>
        set({
          isLoading: true,
          isJsonFallback: false,
          progressStep: "ROUTE",
          progressStepsSeen: ["ROUTE"],
          expandRadiusM: null,
          baseRoute: null,
          partial: null,
          result: null,
          streamWarnings: [],
          error: null,
          nearbyOrigin: null,
        }),
      setJsonFallback: (value) => set({ isJsonFallback: value }),
      setProgressStep: (step, radiusM) =>
        set((s) => ({
          progressStep: step,
          progressStepsSeen: s.progressStepsSeen.includes(step) ? s.progressStepsSeen : [...s.progressStepsSeen, step],
          expandRadiusM: radiusM ?? s.expandRadiusM,
        })),
      setBaseRoute: (baseRoute) => set({ baseRoute }),
      setPartial: (partial) => set({ partial }),
      pushWarning: (warning) => set({ streamWarnings: [...get().streamWarnings, warning] }),
      setResult: (result) => set({ result, isLoading: false, isJsonFallback: false, progressStep: null }),
      setError: (error) => set({ error, isLoading: false, isJsonFallback: false, progressStep: null }),
      setLastSearchKey: (key) => set({ lastSearchKey: key }),

      addRecentSearch: (entry) => {
        const next: RecentSearch = { ...entry, searchedAt: new Date().toISOString() };
        const withoutDup = get().recentSearches.filter(
          (r) => !(r.origin.lat === next.origin.lat && r.origin.lng === next.origin.lng
            && r.destination.lat === next.destination.lat && r.destination.lng === next.destination.lng
            && r.fuel === next.fuel),
        );
        set({ recentSearches: [next, ...withoutDup].slice(0, MAX_RECENT_SEARCHES) });
      },

      reset: () =>
        set({
          isLoading: false,
          isJsonFallback: false,
          progressStep: null,
          progressStepsSeen: [],
          result: null,
          streamWarnings: [],
          error: null,
          detourIntent: null,
          maxDetourDistanceKm: DEFAULT_MAX_DETOUR_DISTANCE_KM,
          nearbyOrigin: null,
          lastSearchKey: null,
        }),

      // 결과 화면에서 홈으로 돌아갈 때 — 연료·필터는 유지, 출발지/목적지만 비운다.
      clearRoute: () =>
        set({
          origin: null,
          destination: null,
          nearbyOrigin: null,
          detourIntent: null,
          maxDetourDistanceKm: DEFAULT_MAX_DETOUR_DISTANCE_KM,
          isJsonFallback: false,
        }),
    }),
    {
      name: "oilpick-search-store",
      storage: createJSONStorage(safeStorage),
      version: 2,
      // v0는 연비가 항상 휘발유 기본값으로 초기화됐다 — 그와 다른 값이면 사용자가 고친 것이고,
      // v1에 저장된 maxDetourDistanceKm은 새 경로에 이어지면 안 되므로 버린다.
      // 같은 값이면 손대지 않은 것이므로 현재 연료의 기본 연비로 맞춰준다.
      migrate: (persisted, version) => {
        const state = persisted as LegacyPersistedState | undefined;
        if (!state) return undefined;
        const { maxDetourDistanceKm: _legacyMaxDetourDistanceKm, ...cleanState } = state;
        void _legacyMaxDetourDistanceKm;
        if (version >= 1 || !cleanState.vehicle) return cleanState as PersistedState;
        const touched = cleanState.vehicle.efficiency !== DEFAULT_EFFICIENCY.GASOLINE;
        return {
          ...cleanState,
          efficiencyTouched: touched,
          vehicle: touched
            ? cleanState.vehicle
            : { ...cleanState.vehicle, efficiency: DEFAULT_EFFICIENCY[cleanState.fuel ?? "GASOLINE"] },
        } as PersistedState;
      },
      // origin/destination/result는 의도적으로 휘발성 — persist하지 않음
      partialize: (state) => ({
        vehicle: state.vehicle,
        efficiencyTouched: state.efficiencyTouched,
        recentSearches: state.recentSearches,
        fuel: state.fuel,
        avoidHighway: state.avoidHighway,
      }),
    },
  ),
);
