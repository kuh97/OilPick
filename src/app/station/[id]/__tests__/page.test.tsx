// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StationDetailView } from "../station-detail-view";
import { useSearchStore } from "@/store/search-store";
import { wgs84 } from "@/domain/types";
import type { WireCandidate, WireSearchResult } from "@/app/api/_lib/types";

vi.mock("react-kakao-maps-sdk", () => ({
  useKakaoLoader: () => [false, undefined],
  Map: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  Polyline: () => null,
  MapMarker: () => null,
}));

const fetchDetourMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/useDetour", () => ({
  useDetour: () => ({ fetchDetour: fetchDetourMock, isLoading: false, error: null }),
}));

function candidate(overrides: Partial<WireCandidate> = {}): WireCandidate {
  return {
    id: "A1",
    name: "E1 홍천충전소",
    brand: "E1G",
    lat: 37.5,
    lng: 127.0,
    address: "강원 홍천군",
    tel: "033-000-0000",
    price: 1102,
    priceUpdatedAt: new Date().toISOString(),
    facilities: { carWash: true, maintenance: false, cvs: false },
    kpetro: false,
    tier: "DETOUR",
    perpDistanceM: 6200,
    detour: { precise: true, distanceM: 12400, durationS: 1080 },
    netSaving: 3252,
    estimatedCost: 49590,
    scores: { balanced: 1, minCost: 1, minDistance: 1 },
    reason: "12.4km 우회하지만 리터당 108원 저렴합니다.",
    ...overrides,
  };
}

function result(overrides: Partial<WireSearchResult> = {}): WireSearchResult {
  return {
    searchId: "s-1",
    baseRoute: { distanceM: 92000, durationS: 5640, polyline: [] },
    candidates: [candidate()],
    referencePrice: 1210,
    refPriceSource: "MEDIAN_T1T2",
    expansion: { triggered: true, finalRadiusM: 7000 },
    warnings: [],
    stage: "DETOUR",
    minutesNeededForOneResult: null,
    ...overrides,
  };
}

beforeEach(() => {
  fetchDetourMock.mockClear();
  useSearchStore.setState({
    origin: wgs84AsPoint(37.42, 127.12),
    destination: wgs84AsPoint(37.88, 127.73),
    result: null,
  });
});

function wgs84AsPoint(lat: number, lng: number) {
  const p = wgs84(lat, lng);
  return { lat: p.lat, lng: p.lng };
}

function renderPage(id = "A1") {
  return render(<StationDetailView id={id} />);
}

const ORIGINAL_USER_AGENT = window.navigator.userAgent;
const ORIGINAL_MAX_TOUCH_POINTS = window.navigator.maxTouchPoints;
function stubUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}
function stubMaxTouchPoints(value: number) {
  Object.defineProperty(window.navigator, "maxTouchPoints", { value, configurable: true });
}
afterEach(() => {
  stubUserAgent(ORIGINAL_USER_AGENT);
  stubMaxTouchPoints(ORIGINAL_MAX_TOUCH_POINTS);
});

describe("StationDetailView — 검색 컨텍스트 없음", () => {
  it("스토어에 result가 없으면 안내 화면을 보여준다", () => {
    renderPage();
    expect(screen.getByText(/검색 컨텍스트가 없습니다/)).toBeTruthy();
  });

  it("result는 있지만 해당 id의 후보가 없으면 안내 화면을 보여준다", () => {
    useSearchStore.setState({ result: result() });
    renderPage("없는-id");
    expect(screen.getByText(/검색 컨텍스트가 없습니다/)).toBeTruthy();
  });
});

describe("StationDetailView — 정상 흐름 (AGENTS.md §6 불변식)", () => {
  beforeEach(() => {
    useSearchStore.setState({ result: result() });
  });

  it("면책 문구는 항상 노출된다", () => {
    renderPage();
    expect(screen.getByText(/가격은 실제와 다를 수 있습니다/)).toBeTruthy();
  });

  it("우회 후보는 전화 확인 권고 문구와 전화번호를 함께 보여준다", () => {
    renderPage();
    expect(screen.getByText(/전화 확인을 권합니다/)).toBeTruthy();
    expect(screen.getByText("033-000-0000")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "033-000-0000" }).getAttribute("href"),
    ).toBe("tel:033-000-0000");
    expect(screen.queryByText(/전화걸기/)).toBeNull();
  });

  it("경로상 후보는 전화 확인 권고 문구를 보여주지 않는다", () => {
    useSearchStore.setState({ result: result({ candidates: [candidate({ tier: "ON_ROUTE" })] }) });
    renderPage();
    expect(screen.queryByText(/전화 확인을 권합니다/)).toBeNull();
  });

  it("데스크톱(비모바일 UA)에서는 티맵 버튼과 안내 문구를 보여주지 않는다 — 티맵은 웹 길찾기가 없음", async () => {
    stubUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    renderPage();
    await screen.findByText("카카오맵"); // 마운트 이펙트가 반영될 때까지 대기
    expect(screen.queryByText("티맵")).toBeNull();
    expect(screen.queryByText(/티맵은 주유소까지만 안내됩니다/)).toBeNull();
    expect(screen.queryByText(/지도 앱은 설치되어 있어야 열 수 있습니다/)).toBeNull();
  });

  it("모바일 UA에서는 티맵 버튼과 안내 문구를 보여준다", async () => {
    stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    renderPage();
    expect(await screen.findByText("티맵")).toBeTruthy();
    expect(screen.getByText("지도 앱은 설치되어 있어야 열 수 있습니다.")).toBeTruthy();
    expect(screen.getByText(/티맵은 주유소까지만 안내됩니다/)).toBeTruthy();
  });

  it("터치 가능한 iPad 데스크톱 UA에서도 모바일 내비 UI를 보여준다", async () => {
    stubMaxTouchPoints(5);
    stubUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15");
    renderPage();
    expect(await screen.findByText("티맵")).toBeTruthy();
    expect(screen.getByText("지도 앱은 설치되어 있어야 열 수 있습니다.")).toBeTruthy();
    expect(screen.getByText(/티맵은 주유소까지만 안내됩니다/)).toBeTruthy();
  });

  it("기본 경로 통행료 + 우회 추가 통행료를 합쳐서 보여준다", () => {
    useSearchStore.setState({
      result: result({
        baseRoute: { distanceM: 92000, durationS: 5640, tollWon: 1000, polyline: [] },
        candidates: [candidate({ detour: { precise: true, distanceM: 12400, durationS: 1080, tollWon: 2900 } })],
      }),
    });
    renderPage();
    expect(screen.getByText("통행료")).toBeTruthy();
    expect(screen.getByText("3,900원 (우회로 +2,900원)")).toBeTruthy();
  });

  it("우회로 인한 추가 통행료가 0원이면 기본 경로 통행료만 보여준다", () => {
    useSearchStore.setState({
      result: result({
        baseRoute: { distanceM: 92000, durationS: 5640, tollWon: 1000, polyline: [] },
        candidates: [candidate({ detour: { precise: true, distanceM: 12400, durationS: 1080, tollWon: 0 } })],
      }),
    });
    renderPage();
    expect(screen.getByText("통행료")).toBeTruthy();
    expect(screen.getByText("1,000원")).toBeTruthy();
  });

  it("기본 경로 통행료를 몰라서(구버전 캐시 등) 합계를 확정할 수 없으면 표시하지 않는다", () => {
    useSearchStore.setState({
      result: result({
        baseRoute: { distanceM: 92000, durationS: 5640, polyline: [] }, // tollWon 없음
        candidates: [candidate({ detour: { precise: true, distanceM: 12400, durationS: 1080, tollWon: 2900 } })],
      }),
    });
    renderPage();
    expect(screen.queryByText("통행료")).toBeNull();
  });

  it("기본 경로·추가분 둘 다 0원으로 확인되면 표시하지 않는다", () => {
    useSearchStore.setState({
      result: result({
        baseRoute: { distanceM: 92000, durationS: 5640, tollWon: 0, polyline: [] },
        candidates: [candidate({ detour: { precise: true, distanceM: 12400, durationS: 1080, tollWon: 0 } })],
      }),
    });
    renderPage();
    expect(screen.queryByText("통행료")).toBeNull();
  });

  it("마운트 시 정밀 재계산(fetchDetour)을 호출한다", () => {
    renderPage();
    expect(fetchDetourMock).toHaveBeenCalledTimes(1);
    expect(fetchDetourMock.mock.calls[0][0]).toMatchObject({ stationId: "A1", priceStation: 1102 });
  });
});
