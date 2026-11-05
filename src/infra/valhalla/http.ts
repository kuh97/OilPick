/** Valhalla POST 호출 — timeout과 상위 AbortSignal을 함께 처리합니다. */

export class ValhallaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValhallaTimeoutError";
  }
}

export async function postValhallaJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Valhalla API HTTP ${response.status}${message ? `: ${message}` : ""}`,
      );
    }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new ValhallaTimeoutError(`Valhalla API timeout (${timeoutMs}ms)`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}
