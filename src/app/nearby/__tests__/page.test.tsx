// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NearbyPage from "../page";

const { useNearbyStationsMock } = vi.hoisted(() => ({
  useNearbyStationsMock: vi.fn(),
}));

vi.mock("@/lib/api/useNearbyStations", () => ({
  useNearbyStations: useNearbyStationsMock,
}));

function mockGeolocation() {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success: (position: { coords: { latitude: number; longitude: number } }) => void) =>
        success({ coords: { latitude: 37.5, longitude: 127.0 } }),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  useNearbyStationsMock.mockReset();
});

describe("NearbyPage — F10 내 주변 주유소", () => {
  it("현재 위치 기준 목록과 가격·거리 정렬 탭을 보여준다", async () => {
    mockGeolocation();
    useNearbyStationsMock.mockReturnValue({
      stations: [{
        id: "A1",
        name: "주변 주유소",
        brand: "SKE",
        lat: 37.5,
        lng: 127.0,
        address: "서울 테스트구",
        tel: null,
        price: 1700,
        priceUpdatedAt: "2026-09-14T00:00:00.000Z",
        facilities: { carWash: true, maintenance: false, cvs: false },
        kpetro: false,
        distanceM: 800,
      }, {
        id: "B1",
        name: "먼 저가 주유소",
        brand: "GS",
        lat: 37.51,
        lng: 127.01,
        address: "서울 테스트구",
        tel: null,
        price: 1600,
        priceUpdatedAt: "2026-09-14T00:00:00.000Z",
        facilities: { carWash: false, maintenance: false, cvs: false },
        kpetro: false,
        distanceM: 1200,
      }],
      isLoading: false,
      error: null,
    });

    render(<NearbyPage />);

    expect(screen.getByText("내 주변 주유소")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "가격순" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "거리순" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("주변 주유소")).toBeTruthy());
    expect(screen.getByText("현재 위치에서 0.8km")).toBeTruthy();
    expect(useNearbyStationsMock).toHaveBeenCalledWith({ lat: 37.5, lng: 127.0 }, "GASOLINE");

    fireEvent.click(screen.getByRole("tab", { name: "거리순" }));
    expect(screen.getAllByRole("heading", { level: 2 })[0].textContent).toBe("주변 주유소");
  });
});
