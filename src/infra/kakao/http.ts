/**
 * kakao/mobility · kakao/local이 공유하는 fetch 유틸.
 * 타임아웃·재시도 정책은 ARCHITECTURE.md §5.4 — 값 자체는 각 클라이언트가 정합니다.
 */

export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  retries: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) throw new Error(`카카오 API HTTP ${res.status}`);
      // 응답 헤더 이후 본문이 멈추는 경우도 호출 타임아웃에 포함한다.
      const body = await res.arrayBuffer();
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
