import { expect, test } from "playwright/test";

const DASHBOARD = {
  range: "24h",
  period: { since: "2026-10-19T00:00:00.000Z", until: "2026-10-20T00:00:00.000Z" },
  priceData: {
    latestImport: {
      pricedOn: "2026-10-19",
      status: "OK",
      startedAt: "2026-10-19T15:00:00.000Z",
      failedGate: null,
      detail: null,
      oilRows: 10_245,
      lpgRows: 1_842,
      geocoded: 3,
    },
    detailBackfill: { done: 900, remaining: 100, total: 1_000 },
  },
  search: {
    completedCount: 120,
    zeroResultRate: 0.05,
    t3Rate: 0.32,
    averageDurationMs: 1_840,
    warningRate: 0.02,
    jsonFallbackRate: 0.08,
    averageDisplayedCandidates: 4.1,
  },
  navi: {
    clickCount: 48,
    clickRate: 0.35,
    averageRank: 1.8,
    byApp: { KAKAO: 22, NAVER: 18, TMAP: 8 },
    byTier: { ON_ROUTE: 39, DETOUR: 9 },
  },
};

const FEEDBACK_COUNTS = { counts: { ALL: 1, NEW: 1, IN_PROGRESS: 0, RESOLVED: 0 } };

const FEEDBACK = {
  id: "e2e-feedback-1",
  email: "e2e@example.com",
  subject: "E2E 문의",
  content: "관리자 화면 E2E 확인용 문의입니다.",
  feedbackSource: "SEARCH" as "HOME" | "NEARBY" | "NEARBY_DETAIL" | "SEARCH" | "SEARCH_DETAIL",
  stationId: null,
  stationName: null,
  searchId: null,
  originName: "성남시청",
  destinationName: "춘천역",
  status: "NEW" as "NEW" | "RESOLVED",
  createdAt: "2026-10-20T00:00:00.000Z",
  resolvedAt: null as string | null,
};

test("관리자 로그인 → 문의 목록 확인 → 문의 상태 변경 및 삭제", async ({ page }) => {
  let feedbackStatus = FEEDBACK.status;
  let feedbackDeleted = false;
  let loginPayload: unknown;

  await page.route("**/api/admin/login", async (route) => {
    loginPayload = JSON.parse(route.request().postData() ?? "null");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/dashboard**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(DASHBOARD) });
  });
  await page.route("**/api/admin/feedback**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/counts")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(feedbackDeleted ? { counts: { ALL: 0, NEW: 0, IN_PROGRESS: 0, RESOLVED: 0 } } : FEEDBACK_COUNTS),
      });
      return;
    }

    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "null") as { status?: "NEW" | "RESOLVED" };
      feedbackStatus = body.status ?? feedbackStatus;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ item: { ...FEEDBACK, status: feedbackStatus, resolvedAt: "2026-10-20T00:01:00.000Z" } }),
      });
      return;
    }

    if (route.request().method() === "DELETE") {
      feedbackDeleted = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: feedbackDeleted
          ? []
          : [{ ...FEEDBACK, status: feedbackStatus, resolvedAt: feedbackStatus === "RESOLVED" ? "2026-10-20T00:01:00.000Z" : null }],
        nextCursor: null,
      }),
    });
  });

  await page.goto("/admin/login");
  await page.getByLabel("관리자 비밀번호").fill("e2e-password");
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/login"));
  await page.getByRole("button", { name: "로그인" }).click();

  expect((await loginResponse).status()).toBe(200);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  expect(loginPayload).toEqual({ password: "e2e-password" });
  await expect(page.getByRole("heading", { name: "운영 대시보드" })).toBeVisible();

  await page.getByRole("tab", { name: "서비스 문의" }).click();
  await expect(page.getByRole("heading", { name: "서비스 문의" })).toBeVisible();
  await expect(page.getByText("E2E 문의")).toBeVisible();

  await page.getByRole("button", { name: "E2E 문의 상태 변경" }).click();
  await page.getByRole("menuitemradio", { name: "처리 완료" }).click();

  await expect(page.getByRole("button", { name: "E2E 문의 상태 변경" })).toContainText("처리 완료");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "E2E 문의 삭제" }).click();
  await expect(page.getByText("E2E 문의")).not.toBeVisible();
});
