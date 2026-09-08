import { describe, expect, it, beforeEach } from "vitest";
import { useSearchStore } from "../search-store";
import { DEFAULT_EFFICIENCY, DEFAULT_REFUEL_AMOUNT, V_TIME, DEFAULT_MAX_DETOUR_MINUTES } from "@/domain/params";

const ORIGIN = { lat: 37.42, lng: 127.12, name: "성남시청" };
const DESTINATION = { lat: 37.88, lng: 127.73, name: "춘천역" };

beforeEach(() => {
  useSearchStore.setState({
    origin: null,
    destination: null,
    fuel: "GASOLINE",
    filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    vehicle: { efficiency: DEFAULT_EFFICIENCY.GASOLINE, refuelAmount: DEFAULT_REFUEL_AMOUNT, timeValue: V_TIME },
    maxDetourMinutes: DEFAULT_MAX_DETOUR_MINUTES,
    mode: "balanced",
    isLoading: false,
    progressStep: null,
    progressStepsSeen: [],
    baseRoute: null,
    partial: null,
    result: null,
    streamWarnings: [],
    error: null,
    recentSearches: [],
  });
});

describe("search-store — 입력", () => {
  it("origin/destination/fuel을 설정한다", () => {
    useSearchStore.getState().setOrigin(ORIGIN);
    useSearchStore.getState().setDestination(DESTINATION);
    useSearchStore.getState().setFuel("LPG");

    expect(useSearchStore.getState().origin).toEqual(ORIGIN);
    expect(useSearchStore.getState().destination).toEqual(DESTINATION);
    expect(useSearchStore.getState().fuel).toBe("LPG");
  });

  it("setVehicle은 부분 갱신이다 — 나머지 필드는 유지된다", () => {
    useSearchStore.getState().setVehicle({ efficiency: 9.5 });
    const vehicle = useSearchStore.getState().vehicle;
    expect(vehicle.efficiency).toBe(9.5);
    expect(vehicle.refuelAmount).toBe(DEFAULT_REFUEL_AMOUNT);
    expect(vehicle.timeValue).toBe(V_TIME);
  });

  // maxDetourMinutes는 filters와 달리 vehicle에 안 묶는다 — API 계약(vehicle)과
  // 무관한 순수 클라이언트 표시 필터이기 때문 (PRODUCT.md §5.2, 2026-09-08).
  it("setMaxDetourMinutes는 다른 필드에 영향을 주지 않는다", () => {
    useSearchStore.getState().setMaxDetourMinutes(35);
    const state = useSearchStore.getState();
    expect(state.maxDetourMinutes).toBe(35);
    expect(state.vehicle.efficiency).toBe(DEFAULT_EFFICIENCY.GASOLINE);
  });
});

describe("search-store — 검색 진행 상태", () => {
  it("startSearch는 이전 result·partial·error를 지운다", () => {
    useSearchStore.setState({
      result: { searchId: "old" } as never,
      error: { code: "X", message: "old" },
    });
    useSearchStore.getState().startSearch();

    const state = useSearchStore.getState();
    expect(state.isLoading).toBe(true);
    expect(state.progressStep).toBe("ROUTE");
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  it("setResult는 isLoading을 false로, progressStep을 null로 되돌린다", () => {
    useSearchStore.getState().startSearch();
    useSearchStore.getState().setResult({ searchId: "s-1" } as never);

    const state = useSearchStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.progressStep).toBeNull();
    expect(state.result).toEqual({ searchId: "s-1" });
  });

  it("setProgressStep은 stepsSeen에 누적되고, EXPAND를 건너뛰면 그 단계는 seen에 없다", () => {
    useSearchStore.getState().startSearch(); // ROUTE
    useSearchStore.getState().setProgressStep("COLLECT");
    useSearchStore.getState().setProgressStep("PRECISE"); // EXPAND 건너뜀

    const state = useSearchStore.getState();
    expect(state.progressStepsSeen).toEqual(["ROUTE", "COLLECT", "PRECISE"]);
    expect(state.progressStepsSeen).not.toContain("EXPAND");
  });

  it("pushWarning은 누적된다", () => {
    useSearchStore.getState().pushWarning({ code: "SHORT_ROUTE", message: "a" });
    useSearchStore.getState().pushWarning({ code: "TIMEOUT", message: "b" });
    expect(useSearchStore.getState().streamWarnings).toHaveLength(2);
  });
});

describe("search-store — 최근 검색", () => {
  it("최대 3건까지만 유지하고, 최신이 앞에 온다", () => {
    const store = useSearchStore.getState();
    for (let i = 0; i < 5; i++) {
      store.addRecentSearch({ origin: { ...ORIGIN, lat: ORIGIN.lat + i }, destination: DESTINATION, fuel: "GASOLINE" });
    }
    const recent = useSearchStore.getState().recentSearches;
    expect(recent).toHaveLength(3);
    expect(recent[0].origin.lat).toBe(ORIGIN.lat + 4); // 가장 최근이 맨 앞
  });

  it("같은 origin·destination·fuel 조합이면 중복 저장하지 않고 최신 것으로 갱신한다", () => {
    const store = useSearchStore.getState();
    store.addRecentSearch({ origin: ORIGIN, destination: DESTINATION, fuel: "GASOLINE" });
    store.addRecentSearch({ origin: ORIGIN, destination: DESTINATION, fuel: "GASOLINE" });
    expect(useSearchStore.getState().recentSearches).toHaveLength(1);
  });
});
