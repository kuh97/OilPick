/**
 * 오피넷 "사업자별 과거 판매가격" CSV 다운로드 — docs/MIGRATION-DB.md §7 Phase D.
 *
 * 오피넷 다운로드는 3중 게이트(진입 NetFunnel + opinet_key 세션 → 폼 프래그먼트
 * AJAX 로드 → 다운로드 NetFunnel) 뒤에 있고 서버 생성에 "수 분"이 걸립니다.
 * 이 게이트들을 순수 HTTP로 흉내내는 건 취약해서, **헤드리스 브라우저(Playwright)**로
 * 실제 페이지를 조작합니다 — 브라우저가 JS 게이트를 전부 네이티브로 통과합니다.
 *
 * 이 모듈은 Vercel 서버리스 함수가 아니라 **GitHub Actions**에서만 실행합니다
 * (scripts/download-opinet-csv.ts). playwright는 devDependency이고, 앱 코드(Next
 * 번들)는 이 파일을 import하지 않습니다.
 *
 * 오피넷이 폼 셀렉터나 페이지 구조를 바꾸면 깨집니다. 그 경우 GitHub Actions가
 * 실패로 시끄럽게 알리고, downloadOne()의 셀렉터만 고치면 됩니다(수동 비상구:
 * Blob에 파일 직접 업로드).
 */

import { chromium, type BrowserContext, type Page } from "playwright";

const PAGE_URL = "https://www.opinet.co.kr/user/opdown/opDownload.do";
/** 전국 일일 파일 생성이 "수 분" 걸림(§7) — 넉넉히 잡는다 */
const DOWNLOAD_TIMEOUT_MS = 240_000;
/** 오피넷 다운로드는 간헐적으로 브라우저 download 이벤트를 누락하므로 1회 재시도한다. */
const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_RETRY_DELAY_MS = 5_000;

export type CsvKind = "OIL" | "LPG";

export interface DownloadedCsv {
  /** 주유소 CSV 원본 바이트 (EUC-KR) */
  oil: Buffer;
  /** 충전소 CSV 원본 바이트 (EUC-KR) */
  lpg: Buffer;
}

/**
 * 지정일(기본: KST 어제)의 주유소·충전소 과거 판매가격 CSV를 내려받는다.
 * @param date "YYYYMMDD". 생략 시 KST 어제.
 */
export async function downloadPriceCsv(date?: string): Promise<DownloadedCsv> {
  const yyyymmdd = date ?? kstYesterday();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext({ acceptDownloads: true, locale: "ko-KR" });
    ctx.setDefaultTimeout(30_000);
    // 이미지·폰트·미디어는 받지 않는다 — 오피넷 페이지에 로드가 안 끝나는 리소스가 섞여 있어
    // waitUntil을 'commit'으로 두고 필요한 요소만 명시적으로 기다린다.
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      return t === "image" || t === "font" || t === "media" ? route.abort() : route.continue();
    });
    const oil = await downloadWithRetry(ctx, "OIL", yyyymmdd);
    const lpg = await downloadWithRetry(ctx, "LPG", yyyymmdd);
    return { oil, lpg };
  } finally {
    await browser.close();
  }
}

async function downloadWithRetry(
  ctx: BrowserContext,
  kind: CsvKind,
  yyyymmdd: string,
): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const page = await ctx.newPage();
    // fn_Download(6)이 띄우는 confirm("...수 분의 처리 시간...") 자동 수락
    page.on("dialog", (d) => void d.accept().catch(() => {}));

    try {
      return await downloadOne(page, kind, yyyymmdd, attempt);
    } catch (error) {
      lastError = error;
      console.warn(
        `⚠ ${kind} ${yyyymmdd} 다운로드 실패 (${attempt}/${DOWNLOAD_ATTEMPTS}): ${errorMessage(error)}`,
      );
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_RETRY_DELAY_MS));
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  throw new Error(
    `${kind} ${yyyymmdd} 다운로드 실패 — ${DOWNLOAD_ATTEMPTS}회 시도 모두 실패: ${errorMessage(lastError)}`,
  );
}

async function downloadOne(
  page: Page,
  kind: CsvKind,
  yyyymmdd: string,
  attempt: number,
): Promise<Buffer> {
  try {
    return await downloadOneInternal(page, kind, yyyymmdd);
  } catch (error) {
    const diagnostics = await collectDiagnostics(page, kind, yyyymmdd, attempt);
    throw new Error(
      `${kind} ${yyyymmdd} 다운로드 실패: ${errorMessage(error)} — ${diagnostics}`,
    );
  }
}

async function downloadOneInternal(
  page: Page,
  kind: CsvKind,
  yyyymmdd: string,
): Promise<Buffer> {
  await page.goto(PAGE_URL, { waitUntil: "commit", timeout: 30_000 });
  await page.waitForSelector("#span_start_date_picker", { timeout: 30_000 });

  // "사업자별 과거 판매가격" 섹션: 구분(주유소 A / 충전소 B), 유가(일일 X), 기간
  await page.check(kind === "OIL" ? "#rdo3" : "#rdo3_1");
  await page.check("#rdo4");
  await page.fill("#span_start_date_picker", yyyymmdd);
  await page.fill("#span_end_date_picker", yyyymmdd);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS }),
    page.click('a[href*="fn_Download(6)"]'), // 과거 판매가격 "CSV저장"
  ]);

  const path = await download.path();
  if (!path) throw new Error(`${kind} 다운로드 실패 (${download.url()})`);
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);

  // 정상 CSV는 최소 수십 KB. 에러 페이지(작은 HTML)면 여기서 걸러진다.
  const head = buf.subarray(0, 200).toString("latin1").toLowerCase();
  if (buf.byteLength < 5_000 || head.includes("<html") || head.includes("error")) {
    throw new Error(
      `${kind} 응답이 CSV가 아닙니다 (${buf.byteLength} bytes) — 오피넷 폼/셀렉터 변경 의심`,
    );
  }
  return buf;
}

async function collectDiagnostics(
  page: Page,
  kind: CsvKind,
  yyyymmdd: string,
  attempt: number,
): Promise<string> {
  const screenshotPath = `opinet-debug-${kind.toLowerCase()}-${yyyymmdd}-attempt-${attempt}.png`;
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => "(title unavailable)"),
    page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => "(body unavailable)"),
  ]);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  const compactBody = bodyText.replace(/\s+/g, " ").trim().slice(0, 500);
  return `url=${page.url()} title=${JSON.stringify(title)} body=${JSON.stringify(compactBody)} screenshot=${screenshotPath}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** KST 기준 "어제" 날짜를 YYYYMMDD로. (테스트를 위해 now 주입 가능) */
export function kstYesterday(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}
