// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("@/lib/api/useSearchStream", () => ({
  useSearchStream: () => ({ search: searchMock }),
}));

vi.mock("@/components/help-drawer", () => ({
  HelpDrawer: () => null,
}));

vi.mock("@/components/result/calc-assumptions", () => ({
  CalcAssumptions: () => null,
}));

vi.mock("@/components/result/filter-sheet", () => ({
  FilterSheet: () => <button type="button">필터</button>,
}));

vi.mock("@/components/result/mode-tabs", () => ({
  ModeTabs: () => <div>정렬 모드</div>,
}));

import ResultPage from "../page";
import { useSearchStore } from "@/store/search-store";
import type { WireSearchResult } from "@/app/api/_lib/types";

const ORIGIN = { lat: 37.42, lng: 127.12, name: "성남시청" };
const DESTINATION = { lat: 37.88, lng: 127.73, name: "춘천역" };
const BASE_ROUTE = {
  distanceM: 92_000,
  durationS: 5_640,
  polyline: [ORIGIN, DESTINATION],
};

function result(overrides: Partial<WireSearchResult> = {}): WireSearchResult {
  return {
    searchId: "search-1",
    baseRoute: BASE_ROUTE,
    baseRoutes: [{ priority: "RECOMMEND", route: BASE_ROUTE }],
    expansion: { triggered: false, finalRadiusM: 0 },
    referencePrice: 1_800,
    refPriceSource: "MEDIAN_T1T2",
    candidates: [],
    warnings: [],
    stage: "ON_ROUTE",
    distanceNeededForOneResultKm: null,
    ...overrides,
  };
}

beforeEach(() => {
  searchMock.mockReset();
  const lastSearchKey = JSON.stringify({
    origin: ORIGIN,
    destination: DESTINATION,
    fuel: "GASOLINE",
    avoidHighway: false,
    detourIntent: null,
  });
  useSearchStore.setState({
    origin: ORIGIN,
    destination: DESTINATION,
    fuel: "GASOLINE",
    avoidHighway: false,
    detourIntent: null,
    isLoading: false,
    isJsonFallback: false,
    progressStep: null,
    progressStepsSeen: [],
    baseRoute: BASE_ROUTE,
    partial: null,
    result: result(),
    streamWarnings: [],
    error: null,
    lastSearchKey,
  });
});

describe("ResultPage — 선택적 우회 탐색", () => {
  it("경로상 결과에서도 허용 우회 거리 기본값을 없음으로 보여준다", () => {
    render(<ResultPage />);

    expect(
      screen.getByRole("button", { name: /허용 우회 거리.*없음/ }),
    ).toBeTruthy();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("거리를 선택하면 경로상 결과와 별개로 우회 포함 재검색을 요청한다", async () => {
    render(<ResultPage />);

    await act(async () => {
      screen.getByRole("button", { name: /허용 우회 거리.*없음/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "5 km 이내" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "적용하고 다시 검색" }).click();
    });

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          includeDetour: true,
          maxDetourDistanceKm: 5,
        }),
      );
    });
  });

  it("경로상 후보가 없어 자동 우회한 결과는 기존 기본값 5km로 표시한다", async () => {
    useSearchStore.setState({
      result: result({
        stage: "DETOUR",
        expansion: { triggered: true, finalRadiusM: 4_200 },
      }),
    });

    render(<ResultPage />);

    await act(async () => {
      screen.getByRole("button", { name: /허용 우회 거리.*5km 이내/ }).click();
    });
    expect(screen.queryByRole("button", { name: "우회 안 함" })).toBeNull();
    expect(searchMock).not.toHaveBeenCalled();
  });
});
