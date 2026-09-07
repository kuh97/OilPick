/**
 * 검색 컨텍스트 — Zustand. PRODUCT.md §5.1(최근 검색)·§9.2(계산 전제 기본값),
 * ARCHITECTURE.md §2(store/search-store.ts).
 *
 * vehicle·recentSearches만 persist합니다 — origin/destination/result는 화면을
 * 벗어나면 다시 검색하는 게 맞는 휘발성 상태입니다(스토어가 빈 채로 /station/:id에
 * 직접 진입하면 "검색 컨텍스트 없음"을 보여주는 것도 이 휘발성 전제 위에 섭니다).
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import {
  DEFAULT_EFFICIENCY,
  DEFAULT_REFUEL_AMOUNT,
  V_TIME,
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
  fuel: Fuel;
  filters: WireFilters;
  vehicle: WireVehicle; // persist — 사용자가 연비·주유량을 수정하면 다음 검색에도 유지
  mode: Mode;

  // ─── 검색 진행 상태 (휘발성) ───────────────────────────────────────────
  isLoading: boolean;
  progressStep: ProgressStep | null;
  /** 실제로 거쳐간 단계만 누적 — EXPAND는 발동 안 하면 건너뛰므로, 순서상 지나간 것으로
   * 잘못 표시하지 않으려면 인덱스 비교가 아니라 이 집합으로 판정해야 한다. */
  progressStepsSeen: ProgressStep[];
  /** EXPAND 단계에서 서버가 실제로 넓힌 반경(m) — 로딩 문구에 실제 값을 보여주는 용도 */
  expandRadiusM: number | null;
  /** STEP 1 직후 도착 — result 전에 헤더·지도를 먼저 그리는 용도 (§6.2) */
  baseRoute: WireBaseRoute | null;
  /** STEP 9 직후 추정치 — result 도착 전 카드 프리뷰용. 전부 detour.precise===false (§6.2) */
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
  setFuel: (fuel: Fuel) => void;
  setFilters: (filters: WireFilters) => void;
  setVehicle: (vehicle: Partial<WireVehicle>) => void;
  setMode: (mode: Mode) => void;

  startSearch: () => void;
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

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      origin: null,
      destination: null,
      fuel: "GASOLINE",
      filters: DEFAULT_FILTERS,
      vehicle: defaultVehicleFor("GASOLINE"),
      mode: "balanced",

      isLoading: false,
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

      setOrigin: (p) => set({ origin: p }),
      setDestination: (p) => set({ destination: p }),
      setFuel: (fuel) => set({ fuel }),
      setFilters: (filters) => set({ filters }),
      setVehicle: (vehicle) => set({ vehicle: { ...get().vehicle, ...vehicle } }),
      setMode: (mode) => set({ mode }),

      startSearch: () =>
        set({
          isLoading: true,
          progressStep: "ROUTE",
          progressStepsSeen: ["ROUTE"],
          expandRadiusM: null,
          baseRoute: null,
          partial: null,
          result: null,
          streamWarnings: [],
          error: null,
        }),
      setProgressStep: (step, radiusM) =>
        set((s) => ({
          progressStep: step,
          progressStepsSeen: s.progressStepsSeen.includes(step) ? s.progressStepsSeen : [...s.progressStepsSeen, step],
          expandRadiusM: radiusM ?? s.expandRadiusM,
        })),
      setBaseRoute: (baseRoute) => set({ baseRoute }),
      setPartial: (partial) => set({ partial }),
      pushWarning: (warning) => set({ streamWarnings: [...get().streamWarnings, warning] }),
      setResult: (result) => set({ result, isLoading: false, progressStep: null }),
      setError: (error) => set({ error, isLoading: false, progressStep: null }),
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
          progressStep: null,
          progressStepsSeen: [],
          result: null,
          streamWarnings: [],
          error: null,
          lastSearchKey: null,
        }),

      // 결과 화면에서 홈으로 돌아갈 때 — 연료·필터는 유지, 출발지/목적지만 비운다.
      clearRoute: () => set({ origin: null, destination: null }),
    }),
    {
      name: "oilpick-search-store",
      storage: createJSONStorage(safeStorage),
      // origin/destination/result는 의도적으로 휘발성 — persist하지 않음
      partialize: (state) => ({
        vehicle: state.vehicle,
        recentSearches: state.recentSearches,
        fuel: state.fuel,
      }),
    },
  ),
);
