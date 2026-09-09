/**
 * persist v0 → v1 마이그레이션 — v0는 연비를 항상 휘발유 기본값으로 초기화했으므로,
 * 저장된 연비가 휘발유 기본값이면 "손대지 않음"으로 보고 현재 연료의 기본값으로 고쳐준다.
 *
 * jsdom 대신 window.localStorage만 스텁한다 — 저장소 왕복이 전부이고,
 * 이 저장소에서 jsdom 환경은 별건으로 깨져 있다.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_EFFICIENCY, DEFAULT_REFUEL_AMOUNT, V_TIME } from "@/domain/params";
import type { Fuel } from "@/app/api/_lib/types";

const KEY = "oilpick-search-store";
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function seedV0(fuel: Fuel, efficiency: number) {
  store.set(
    KEY,
    JSON.stringify({
      state: {
        vehicle: { efficiency, refuelAmount: DEFAULT_REFUEL_AMOUNT, timeValue: V_TIME },
        recentSearches: [],
        fuel,
      },
      version: 0,
    }),
  );
}

async function loadStore() {
  vi.resetModules();
  const { useSearchStore } = await import("../search-store");
  return useSearchStore;
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search-store — persist 마이그레이션", () => {
  it("v0에서 LPG를 고른 채 휘발유 연비가 굳어 있으면 LPG 기본 연비로 고친다", async () => {
    seedV0("LPG", DEFAULT_EFFICIENCY.GASOLINE);
    const useSearchStore = await loadStore();

    expect(useSearchStore.getState().vehicle.efficiency).toBe(DEFAULT_EFFICIENCY.LPG);
    expect(useSearchStore.getState().efficiencyTouched).toBe(false);
  });

  it("v0에서 사용자가 직접 고친 연비는 그대로 둔다", async () => {
    seedV0("LPG", 9.5);
    const useSearchStore = await loadStore();

    expect(useSearchStore.getState().vehicle.efficiency).toBe(9.5);
    expect(useSearchStore.getState().efficiencyTouched).toBe(true);
  });
});
