/**
 * 오피넷 HTTP 클라이언트.
 * 타임아웃 · 재시도 · 동시성 제한 — ARCHITECTURE.md §5.4
 *
 * 기본 수집: timeout 4s, retry 1회
 * 확장 수집: timeout 4s, retry 0회 (best-effort)
 */

import { env } from "@/infra/env";
import {
  OpinetRadiusResponseSchema,
  OpinetDetailResponseSchema,
  AreaCodeResponseSchema,
  AvgSigunPriceResponseSchema,
  type OpinetRadiusItem,
  type OpinetDetailItem,
  type AreaCodeItem,
  type AvgSigunPriceItem,
} from "./schema";
import type { KatecPoint } from "@/domain/types";
import { SEARCH_RADIUS } from "@/domain/params";
import { FUEL_TO_PRODCD } from "./mapper";
import type { Fuel } from "@/domain/types";

// ─── 동시성 제한 ──────────────────────────────────────────────────────────────

export interface Semaphore {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(limit: number): Semaphore {
  let running = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && running < limit) {
      running++;
      queue.shift()!();
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        if (running < limit) {
          running++;
          resolve();
        } else {
          queue.push(resolve);
        }
      });
      try {
        return await fn();
      } finally {
        running--;
        next();
      }
    },
  };
}

// 모듈 레벨 세마포어 — 기본값은 env에서 읽음. 테스트에서 교체 가능
let _semaphore: Semaphore | undefined;
export function getSemaphore(): Semaphore {
  if (!_semaphore) _semaphore = createSemaphore(env.OPINET_CONCURRENCY);
  return _semaphore;
}
export function setSemaphore(s: Semaphore) { _semaphore = s; }

// ─── fetch 유틸 ───────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`오피넷 HTTP ${res.status}`);
    // fetch()가 헤더만 받은 뒤 반환될 수 있으므로, 본문을 읽는 동안에도
    // 같은 타임아웃을 유지한다. 서버리스에서 응답 본문이 멈추면 함수가
    // Vercel maxDuration까지 붙잡히는 것을 막는다.
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 4_000;

export interface FetchRadiusOptions {
  center: KatecPoint;
  fuel: Fuel;
  certKey?: string;
  retries?: number;   // 기본 1. 확장 수집 호출 시 0으로 설정
}

/**
 * 반경 내 주유소 검색.
 * 반경은 내 주변 검색 설정(SEARCH_RADIUS)을 사용한다.
 */
export async function fetchRadius(opts: FetchRadiusOptions): Promise<OpinetRadiusItem[]> {
  const certKey = opts.certKey ?? env.OPINET_CERT_KEY;
  const retries = opts.retries ?? 1;
  const prodcd = FUEL_TO_PRODCD[opts.fuel];

  const params = new URLSearchParams({
    certkey: certKey,
    out: "json",
    x: String(opts.center.x),
    y: String(opts.center.y),
    radius: String(SEARCH_RADIUS),
    prodcd,
    sort: "1",
  });

  const url = `${env.OPINET_BASE_URL}/aroundAll.do?${params}`;

  return getSemaphore().run(async () => {
    const res = await fetchWithRetry(url, TIMEOUT_MS, retries);
    const json = await res.json();
    const parsed = OpinetRadiusResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error(`오피넷 반경검색 응답 파싱 실패: ${parsed.error.message}`);
    return parsed.data.RESULT.OIL;
  });
}

export interface FetchDetailOptions {
  uniId: string;
  certKey?: string;
  retries?: number;
}

/**
 * 주유소 상세정보 (Fallback C).
 * DB 마스터에 없는 신규 주유소 보강용.
 */
export async function fetchDetail(opts: FetchDetailOptions): Promise<OpinetDetailItem | null> {
  const certKey = opts.certKey ?? env.OPINET_CERT_KEY;
  const retries = opts.retries ?? 1;

  const params = new URLSearchParams({
    certkey: certKey,
    out: "json",
    id: opts.uniId,
  });

  const url = `${env.OPINET_BASE_URL}/detailById.do?${params}`;

  return getSemaphore().run(async () => {
    const res = await fetchWithRetry(url, TIMEOUT_MS, retries);
    const json = await res.json();
    const parsed = OpinetDetailResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error(`오피넷 상세 응답 파싱 실패: ${parsed.error.message}`);
    return parsed.data.RESULT.OIL[0] ?? null;
  });
}

export interface FetchAreaCodesOptions {
  certKey?: string;
  retries?: number;
}

/**
 * 시도코드 목록 조회 (§7.2 시군구 평균가 동기화 — 순회 대상).
 * `area` 파라미터를 생략하면 시도별 코드가 반환됩니다.
 */
export async function fetchAreaCodes(opts: FetchAreaCodesOptions = {}): Promise<AreaCodeItem[]> {
  const certKey = opts.certKey ?? env.OPINET_CERT_KEY;
  const retries = opts.retries ?? 1;

  const params = new URLSearchParams({ certkey: certKey, out: "json" });
  const url = `${env.OPINET_BASE_URL}/areaCode.do?${params}`;

  return getSemaphore().run(async () => {
    const res = await fetchWithRetry(url, TIMEOUT_MS, retries);
    const json = await res.json();
    const parsed = AreaCodeResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error(`오피넷 지역코드 응답 파싱 실패: ${parsed.error.message}`);
    return parsed.data.RESULT.OIL;
  });
}

export interface FetchAvgSigunPriceOptions {
  sido: string;          // 시도코드 2자리
  certKey?: string;
  retries?: number;
}

/**
 * 시도 내 시군구별 평균가격 조회 (§7.2 `sigungu_avg_price` 동기화 원본).
 * `sigun`을 생략하면 해당 시도의 전체 시군구가 반환됩니다.
 */
export async function fetchAvgSigunPrice(
  opts: FetchAvgSigunPriceOptions,
): Promise<AvgSigunPriceItem[]> {
  const certKey = opts.certKey ?? env.OPINET_CERT_KEY;
  const retries = opts.retries ?? 1;

  const params = new URLSearchParams({ certkey: certKey, out: "json", sido: opts.sido });
  const url = `${env.OPINET_BASE_URL}/avgSigunPrice.do?${params}`;

  return getSemaphore().run(async () => {
    const res = await fetchWithRetry(url, TIMEOUT_MS, retries);
    const json = await res.json();
    const parsed = AvgSigunPriceResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error(`오피넷 시군구 평균가 응답 파싱 실패: ${parsed.error.message}`);
    return parsed.data.RESULT.OIL;
  });
}
