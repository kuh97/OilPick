/**
 * 일일 유가 CSV의 Vercel Blob 보관소 — docs/MIGRATION-DB.md §7 Phase D.
 *
 * GitHub Actions(scripts/download-opinet-csv.ts)가 오피넷에서 받아 여기에 올리고,
 * Vercel Cron(/api/cron/import-prices)이 `latest`를 읽어 임포트합니다. Blob은
 * 수동 비상구이기도 합니다 — 스크래핑이 깨지면 파일만 직접 올리면 임포트는 계속 돕니다.
 */

import { put, list } from "@vercel/blob";
import { env } from "@/infra/env";

const LATEST_OIL = "opinet/latest/oil.csv";
const LATEST_LPG = "opinet/latest/lpg.csv";
const BLOB_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Vercel Blob 요청 타임아웃")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchBlobBytes(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Vercel Blob HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** 다운로드한 CSV 2개를 `latest`(덮어쓰기) + `archive/{종류}-YYYYMMDD.csv`로 저장. */
export async function putPriceCsvs(oil: Buffer, lpg: Buffer, dateYyyymmdd: string): Promise<void> {
  const opts = {
    access: "public" as const,
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/csv",
  };
  await Promise.all([
    put(LATEST_OIL, oil, opts),
    put(LATEST_LPG, lpg, opts),
    put(`opinet/archive/oil-${dateYyyymmdd}.csv`, oil, opts),
    put(`opinet/archive/lpg-${dateYyyymmdd}.csv`, lpg, opts),
  ]);
}

/** `latest` CSV 2개를 바이트로 가져온다. 없으면 throw (임포트는 DOWNLOAD_FAILED로 기록). */
export async function getLatestPriceCsvs(): Promise<{ oil: Buffer; lpg: Buffer }> {
  const { blobs } = await withTimeout(
    list({ prefix: "opinet/latest/", token: env.BLOB_READ_WRITE_TOKEN }),
    BLOB_TIMEOUT_MS,
  );
  const oilBlob = blobs.find((b) => b.pathname === LATEST_OIL);
  const lpgBlob = blobs.find((b) => b.pathname === LATEST_LPG);
  if (!oilBlob || !lpgBlob) {
    throw new Error("Blob opinet/latest/ 에 oil.csv 또는 lpg.csv가 없습니다");
  }
  const [oil, lpg] = await Promise.all([
    fetchBlobBytes(oilBlob.url),
    fetchBlobBytes(lpgBlob.url),
  ]);
  return { oil, lpg };
}
