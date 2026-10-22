import { expect, test, type Page, type Route } from "playwright/test";

const ORIGIN = {
  name: "서울시청",
  address: "서울특별시 중구 세종대로 110",
  lat: 37.5665,
  lng: 126.978,
};

const DESTINATION = {
  name: "부산역",
  address: "부산광역시 동구 중앙대로 206",
  lat: 35.1151,
  lng: 129.0422,
};

const BASE_ROUTE = {
  distanceM: 398_000,
  durationS: 14_400,
  tollWon: 12_000,
  polyline: [
    { lat: ORIGIN.lat, lng: ORIGIN.lng },
    { lat: DESTINATION.lat, lng: DESTINATION.lng },
  ],
};

const CANDIDATE = {
  id: "STATION-1",
  name: "오일픽 테스트 주유소",
  brand: "SKE",
  lat: 37.51,
  lng: 127.01,
  address: "서울특별시 테스트구 테스트로 1",
  tel: "02-1234-5678",
  price: 1_700,
  priceUpdatedAt: "2026-09-14T00:00:00.000Z",
  facilities: { carWash: true, maintenance: false, cvs: true },
  kpetro: false,
  tier: "ON_ROUTE" as const,
  perpDistanceM: 100,
  detour: { precise: true, distanceM: 300, durationS: 30, tollWon: 0 },
  netSaving: 450,
  estimatedCost: 76_500,
  scores: { balanced: 1_000, minCost: 900, minDistance: 100 },
  reason: "평균보다 저렴하고 가는 길에 있어요.",
};

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function searchResult(candidates: typeof CANDIDATE[] | []) {
  return {
    searchId: "e2e-search-1",
    baseRoute: BASE_ROUTE,
    expansion: { triggered: false, finalRadiusM: 2_000 },
    referencePrice: 1_800,
    refPriceSource: "MEDIAN_T1T2" as const,
    candidates,
    warnings: [],
    stage: "ON_ROUTE" as const,
    minutesNeededForOneResult: null,
  };
}

async function mockPlaces(route: Route) {
  const query = new URL(route.request().url()).searchParams.get("q") ?? "";
  const place = query.includes("부산") ? DESTINATION : ORIGIN;
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ places: [place] }),
  });
}

async function chooseRoute(page: Page) {
  await page.goto("/");
  const startLink = page.getByRole("link", { name: "지금 경로 찾기" });
  await expect(startLink).toBeVisible();
  // 랜딩은 서버 마크업을 먼저 보여주므로 React 이벤트 핸들러가 연결된 뒤 클릭한다.
  await page.waitForTimeout(500);
  await startLink.click();
  await expect(page).toHaveURL(/\/home$/);

  const originInput = page.getByRole("textbox", { name: "출발지" });
  await originInput.fill("서울");
  await expect(page.getByRole("button", { name: /서울시청/ })).toBeVisible();
  await page.getByRole("button", { name: /서울시청/ }).click();

  const destinationInput = page.getByRole("textbox", { name: "목적지" });
  await destinationInput.fill("부산");
  await expect(page.getByRole("button", { name: /부산역/ })).toBeVisible();
  await page.getByRole("button", { name: /부산역/ }).click();

  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/\/result$/);
}

async function blockExternalMap(page: Page) {
  await page.route("https://dapi.kakao.com/**", (route) => route.abort());
  await page.route("**/api/places/search**", mockPlaces);
  await page.route("**/api/events/navi", (route) => route.fulfill({ status: 204 }));
  await page.context().route(/^https?:\/\/map\.kakao\.com\//, (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>지도 앱 연결 확인</title>",
  }));
}

async function expectPreparationCompletes(page: Page, screenshotName: string) {
  const status = page.getByRole("status");
  await expect(status.getByText("곧 결과를 보여드릴게요", { exact: true })).toBeVisible();
  // 결과를 먼저 받아도 준비 화면이 포인터의 실제 SVG 끝점 도착까지 유지되는지 검증한다.
  await expect.poll(async () => status.locator('svg > g:last-child').evaluate((element) => {
    const marker = element as SVGGElement;
    const path = marker.parentElement!.querySelector<SVGPathElement>('path[pathLength="1"]')!;
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const matrix = marker.transform.baseVal.consolidate()!.matrix;
    return Math.hypot(matrix.e - endpoint.x, matrix.f - endpoint.y);
  }), { intervals: [30, 50, 50] }).toBeLessThan(0.1);
  await expect(status.locator('path[pathLength="1"]')).toHaveCSS("stroke-dashoffset", "0px");
  await page.screenshot({ path: `test-results/${screenshotName}.png` });
}

test("검색 → SSE 지연 시 JSON 폴백 → 상세 → 카카오맵 딥링크", async ({ page }) => {
  await blockExternalMap(page);
  await page.route("**/api/search", async (route) => {
    const accept = route.request().headers().accept ?? "";

    if (accept.includes("text/event-stream")) {
      // 첫 바이트가 3초 안에 오지 않는 인앱 브라우저 버퍼링을 재현한다.
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      try {
        await route.fulfill({
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          body: sseEvent("result", searchResult([CANDIDATE])),
        });
      } catch {
        // 클라이언트가 3초 타임아웃으로 요청을 먼저 취소하는 것은 정상이다.
      }
      return;
    }

    expect(accept).toContain("application/json");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(searchResult([CANDIDATE])),
    });
  });
  await page.route("**/api/detour", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        distanceM: 300,
        durationS: 30,
        precise: true,
        netSaving: 450,
        tollWon: 0,
        polyline: BASE_ROUTE.polyline,
      }),
    });
  });

  const sseRequest = page.waitForRequest((request) => {
    return request.url().includes("/api/search") && request.headers().accept?.includes("text/event-stream") === true;
  });
  const jsonFallbackRequest = page.waitForRequest((request) => {
    return request.url().includes("/api/search") && request.headers().accept?.includes("application/json") === true;
  });
  await chooseRoute(page);
  await expectPreparationCompletes(page, "loading-json-preparation");
  expect((await sseRequest).headers().accept).toContain("text/event-stream");
  await jsonFallbackRequest;
  await expect(page.getByText("오일픽 테스트 주유소")).toBeVisible();
  await page.getByRole("link", { name: /오일픽 테스트 주유소/ }).click();
  await expect(page).toHaveURL(/\/station\/STATION-1$/);
  await expect(page.getByRole("heading", { name: "추천 이유" })).toBeVisible();
  await expect(page.getByText("1,700원/L")).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "카카오맵" }).click();
  const popup = await popupPromise;
  // 외부 지도 접속은 목킹하고 생성된 목적지 URL을 검증한다.
  await expect(popup).toHaveURL(/https:\/\/map\.kakao\.com\//);
  await popup.close();
});

test("후보 0건 → 다른 경로로 다시 찾기 대안", async ({ page }) => {
  await blockExternalMap(page);
  await page.route("**/api/search", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache" },
      body: [
        sseEvent("progress", { step: "ROUTE" }),
        sseEvent("base_route", BASE_ROUTE),
        sseEvent("result", searchResult([])),
      ].join(""),
    });
  });

  await chooseRoute(page);
  await expectPreparationCompletes(page, "loading-skipped-preparation");
  await expect(page.getByText("이 경로에서는 조건에 맞는 주유소를 찾지 못했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "다른 경로로 다시 찾기" })).toBeVisible();
});
