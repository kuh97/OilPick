/**
 * 일일 유가 CSV의 Vercel Blob 보관소 — docs/MIGRATION-DB.md §7 Phase D.
 *
 * GitHub Actions(scripts/download-opinet-csv.ts)가 오피넷에서 받아 여기에 올리고,
 * Vercel Cron(/api/cron/import-prices)이 `latest`를 읽어 임포트합니다. Blob은
 * 수동 비상구이기도 합니다 — 스크래핑이 깨지면 파일만 직접 올리면 임포트는 계속 돕니다.
 */

import { put, list } from "@vercel/blob";
import { randomUUID } from "node:crypto";
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

function withCacheBust(url: string, cacheBust: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("oilpick_cache_bust", cacheBust);
  return parsed.toString();
}

async function fetchBlobBytes(url: string, cacheBust: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOB_TIMEOUT_MS);
  try {
    // `latest` is overwritten at a fixed public pathname. A unique query is
    // required because Vercel Blob's public URL is served through its CDN.
    const res = await fetch(withCacheBust(url, cacheBust), {
      cache: "no-store",
      signal: controller.signal,
    });
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
    // Keep stale public-CDN responses short-lived as a fallback for readers
    // that do not use the cache-busting query parameter.
    cacheControlMaxAge: 60,
  };
  await Promise.all([
    put(LATEST_OIL, oil, opts),
    put(LATEST_LPG, lpg, opts),
    put(`opinet/archive/oil-${dateYyyymmdd}.csv`, oil, opts),
    put(`opinet/archive/lpg-${dateYyyymmdd}.csv`, lpg, opts),
  ]);
}

/** `latest` CSV 2개를 바이트로 가져온다. 없으면 throw (임포트는 DOWNLOAD_FAILED로 기록). */
export async function getLatestPriceCsvs(
  cacheBust: string = randomUUID(),
): Promise<{ oil: Buffer; lpg: Buffer }> {
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
    fetchBlobBytes(oilBlob.url, cacheBust),
    fetchBlobBytes(lpgBlob.url, cacheBust),
  ]);
  return { oil, lpg };
}
