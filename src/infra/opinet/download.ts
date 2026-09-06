/**
 * 오피넷 "사업자별 과거 판매가격" CSV 다운로드 — docs/MIGRATION-DB.md §7 Phase D.
 *
 * 이 경로는 취약합니다(NetFunnel 대기열 + 서버 생성에 수 분). 그래서 Vercel Cron
 * 함수가 아니라 **GitHub Actions**에서 실행합니다(scripts/download-opinet-csv.ts).
 * Cron은 이 결과가 올라간 Blob을 읽기만 합니다.
 *
 * 흐름:
 *   1. opDownload.do GET — 세션 쿠키(WMONID·JSESSIONID) 확보
 *   2. nfl.opinet.co.kr/ts.wseq GET — NetFunnel 키 확보 (대기열 없으면 bypass)
 *   3. main_download_csv_big.do POST — form1 필드로 CSV 받기 (EUC-KR 바이트)
 *
 * 오피넷이 폼 필드나 NetFunnel 설정을 바꾸면 조용히 깨집니다. 그 경우 GitHub
 * Actions가 실패로 시끄럽게 알리고, 이 파일만 고치면 됩니다(수동 비상구: Blob에
 * 파일 직접 업로드).
 */

const PAGE_URL = "https://www.opinet.co.kr/user/opdown/opDownload.do";
const DOWNLOAD_URL = "https://www.opinet.co.kr/user/main/main_download_csv_big.do";
const NETFUNNEL_URL = "https://nfl.opinet.co.kr/ts.wseq";
const NETFUNNEL_SID = "service_1";
const NETFUNNEL_AID = "B7"; // fn_Download(6) → NetFunnel_Action({action_id:"B7"})

const DOWNLOAD_TIMEOUT_MS = 180_000; // 서버 생성이 "수 분" 걸림 (§7)
const NETFUNNEL_MAX_POLLS = 20;
const NETFUNNEL_POLL_INTERVAL_MS = 2_000;

export type CsvKind = "OIL" | "LPG";

export interface DownloadedCsv {
  oil: Buffer;
  lpg: Buffer;
}

/** Set-Cookie 헤더들에서 "name=value; name2=value2" Cookie 문자열을 만든다. */
function collectCookies(res: Response, jar: Map<string, string>): void {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  for (const line of setCookies) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** ts.wseq 응답 문자열에서 key=... 를 뽑는다. bypass면 빈 문자열. (테스트를 위해 export) */
export function parseNetFunnelKey(body: string): { key: string; waiting: boolean } {
  // 예: NetFunnel.gControl.result='5002:200:key=...&ip=...&ttl=...';
  const status = body.match(/result=['"](\d+):/)?.[1];
  const key = body.match(/key=([^&'"]+)/)?.[1] ?? "";
  // 5002 = bypass(대기 없음), 5001 = 발급 완료. 그 외(예: 5101 + nwait)면 대기 중.
  const waiting = status !== "5002" && status !== "5001" && key !== "";
  return { key: decodeURIComponent(key), waiting };
}

async function acquireNetFunnelKey(jar: Map<string, string>): Promise<string> {
  for (let attempt = 0; attempt < NETFUNNEL_MAX_POLLS; attempt++) {
    const params = new URLSearchParams({
      opcode: "5101",
      nfid: "0",
      prefix: "NetFunnel.gControl.result",
      sid: NETFUNNEL_SID,
      aid: NETFUNNEL_AID,
      js: "yes",
      ts: String(Date.now()),
    });
    const res = await fetch(`${NETFUNNEL_URL}?${params}`, {
      headers: { Cookie: cookieHeader(jar), Referer: PAGE_URL },
    });
    collectCookies(res, jar);
    const body = await res.text();
    const { key, waiting } = parseNetFunnelKey(body);
    if (!waiting) return key;
    await new Promise((r) => setTimeout(r, NETFUNNEL_POLL_INTERVAL_MS));
  }
  throw new Error("NetFunnel 대기열을 통과하지 못했습니다 (20회 폴링 초과)");
}

async function downloadOne(
  kind: CsvKind,
  yyyymmdd: string,
  jar: Map<string, string>,
  netfunnelKey: string,
): Promise<Buffer> {
  const body = new URLSearchParams({
    LPG_CD: kind === "OIL" ? "A" : "B",
    DATE_DIV_CD: "X", // 일일유가
    PAGE_DIV: "PAGE_DIV_6", // 과거 판매가격 CSV
    START_DT: yyyymmdd,
    END_DT: yyyymmdd,
    SIDO_CD: "",
    SIGUN_CD: "",
    SIDO_NM: "",
    SIGUN_NM: "",
    API_GBN: "A",
    netfunnel_key: netfunnelKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(DOWNLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
        Referer: PAGE_URL,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`다운로드 응답 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // 정상 CSV는 최소 수십 KB. 에러 페이지(작은 HTML)면 여기서 걸러진다.
    const head = buf.subarray(0, 200).toString("latin1").toLowerCase();
    if (buf.byteLength < 5_000 || head.includes("<html") || head.includes("error")) {
      throw new Error(
        `${kind} 응답이 CSV가 아닙니다 (${buf.byteLength} bytes) — NetFunnel 키 만료 또는 폼 변경 의심`,
      );
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 지정일(기본: 어제)의 주유소·충전소 과거 판매가격 CSV를 내려받는다.
 * @param date "YYYYMMDD". 생략 시 KST 기준 어제.
 */
export async function downloadPriceCsv(date?: string): Promise<DownloadedCsv> {
  const yyyymmdd = date ?? kstYesterday();
  const jar = new Map<string, string>();

  const page = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
  collectCookies(page, jar);
  await page.text();

  // 다운로드마다 새 키를 받는다 (fn_Download가 호출마다 NetFunnel_Action을 새로 함)
  const oil = await downloadOne("OIL", yyyymmdd, jar, await acquireNetFunnelKey(jar));
  const lpg = await downloadOne("LPG", yyyymmdd, jar, await acquireNetFunnelKey(jar));
  return { oil, lpg };
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function kstYesterday(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kstNow.setUTCDate(kstNow.getUTCDate() - 1);
  return kstNow.toISOString().slice(0, 10).replace(/-/g, "");
}
