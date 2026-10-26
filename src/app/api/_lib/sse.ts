/**
 * SSE 프레이밍 — ARCHITECTURE.md §6.2.
 * `EventSource`를 쓰지 않는 이유(자동 재연결 = 파이프라인 재실행 = 오피넷 예산 낭비)는
 * 클라이언트 쪽 규칙이지만, 프레임 포맷은 여기서 서버 쪽 단일 출처로 둡니다.
 */

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseController {
  enqueue(chunk: string): void;
  signal: AbortSignal;
}

/**
 * SSE `ReadableStream`을 만듭니다.
 * `producer`는 스스로 실패를 처리해 `error` 프레임을 enqueue해야 합니다 — 이 함수는
 * `producer`가 끝나면(성공이든 producer 내부에서 처리된 실패든) 무조건 스트림을 닫습니다.
 * "error 이후 무발신"은 이 종료 시점으로 보장됩니다.
 */
export function createSseStream(
  producer: (controller: SseController) => Promise<void>,
  externalSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let canceled = false;
  const producerAbort = new AbortController();

  const abortProducer = () => {
    if (!producerAbort.signal.aborted) {
      producerAbort.abort(externalSignal?.reason);
    }
  };

  if (externalSignal?.aborted) abortProducer();
  else externalSignal?.addEventListener("abort", abortProducer, { once: true });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const wrapped: SseController = {
        enqueue: (chunk: string) => {
          if (canceled || producerAbort.signal.aborted) return;
          if (controller.desiredSize === null) {
            canceled = true;
            abortProducer();
            return;
          }
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch (err) {
            if (controller.desiredSize === null) {
              canceled = true;
              abortProducer();
              return;
            }
            throw err;
          }
        },
        signal: producerAbort.signal,
      };
      try {
        await producer(wrapped);
      } finally {
        externalSignal?.removeEventListener("abort", abortProducer);
        if (!canceled && controller.desiredSize !== null) controller.close();
      }
    },
    cancel() {
      canceled = true;
      abortProducer();
    },
  });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;
