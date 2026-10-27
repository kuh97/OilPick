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

vi.mock("@/lib/api/reverseGeocode", () => ({
  reverseGeocode: vi.fn().mockResolvedValue("서울 테스트구 테스트로 1"),
}));

vi.mock("@/components/nearby-map", () => ({
  NearbyMap: ({
    stations,
    onSelectStation,
    onSearchAtPoint,
  }: {
    stations: Array<{ id: string; name: string; price: number }>;
    onSelectStation: (stationId: string | null) => void;
    onSearchAtPoint: (point: { lat: number; lng: number }) => void;
  }) => (
    <div data-testid="nearby-map" role="region" aria-label="주변 주유소 지도">
      {stations.map((station) => (
        <button
          key={station.id}
          type="button"
          aria-label={`${station.name}, ${station.price.toLocaleString()}원/L`}
          onClick={() => onSelectStation(station.id)}
        >
          {station.price.toLocaleString()}
        </button>
      ))}
      <button type="button" onClick={() => onSearchAtPoint({ lat: 37.51, lng: 127.01 })}>
        이 위치에서 다시 찾기
      </button>
    </div>
  ),
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
  it("현재 위치 기준 지도와 가격 마커를 보여주고 연료 선택을 유지한다", async () => {
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
    const gasolineRadios = screen.getAllByRole("radio", { name: "휘발유" });
    expect(gasolineRadios).toHaveLength(2);
    expect(gasolineRadios.every((radio) => radio.getAttribute("aria-checked") === "true")).toBe(true);
    expect(screen.getByRole("button", { name: /필터/ })).toBeTruthy();
    expect(screen.queryByText("현재 위치 기준 5km")).toBeNull();
    expect(screen.queryByText(/곳을 찾았어요/)).toBeNull();
    expect(screen.getByTestId("nearby-map")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /주변 주유소, 1,700원\/L/ })).toBeTruthy());
    expect(useNearbyStationsMock).toHaveBeenCalledWith(
      { lat: 37.5, lng: 127.0 },
      "GASOLINE",
      { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    );

    fireEvent.click(screen.getByRole("button", { name: /주변 주유소, 1,700원\/L/ }));
    expect(screen.getAllByText("직선거리 0km")).toHaveLength(2);
    expect(screen.getAllByText("2026-09-14 기준")).toHaveLength(2);
    expect(screen.getAllByText("45L 주유 시 예상 76,500원")).toHaveLength(2);
    expect(screen.getAllByText("가격은 실제와 다를 수 있습니다.")).toHaveLength(2);
    const detailLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/station/A1");
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks.every((link) => link.getAttribute("href") === "/station/A1")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "이 위치에서 다시 찾기" }));
    await waitFor(() => expect(useNearbyStationsMock).toHaveBeenLastCalledWith(
      { lat: 37.51, lng: 127.01 },
      "GASOLINE",
      { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    ));
  });
});
