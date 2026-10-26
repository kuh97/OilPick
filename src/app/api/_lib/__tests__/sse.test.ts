import { describe, expect, it } from "vitest";
import { sseEvent, createSseStream } from "../sse";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

describe("sseEvent", () => {
  it("event/data 두 줄과 빈 줄로 프레임을 만든다", () => {
    expect(sseEvent("progress", { step: "ROUTE" })).toBe('event: progress\ndata: {"step":"ROUTE"}\n\n');
  });
});

describe("createSseStream", () => {
  it("producer가 enqueue한 프레임을 순서대로 흘려보낸다", async () => {
    const stream = createSseStream(async (controller) => {
      controller.enqueue(sseEvent("progress", { step: "ROUTE" }));
      controller.enqueue(sseEvent("result", { ok: true }));
    });

    const text = await readAll(stream);
    expect(text).toBe('event: progress\ndata: {"step":"ROUTE"}\n\nevent: result\ndata: {"ok":true}\n\n');
  });

  it("producer가 끝나면(성공이든 내부에서 처리한 실패든) 스트림을 닫는다", async () => {
    const stream = createSseStream(async (controller) => {
      controller.enqueue(sseEvent("error", { code: "INTERNAL_ERROR", message: "실패" }));
      // 여기서 더 enqueue해도 스트림은 이미 닫힌 뒤이므로 다음 read()는 done:true여야 한다
    });

    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const second = await reader.read();
    expect(second.done).toBe(true);
  });

  it("producer가 throw해도(방어하지 못한 예외) 스트림은 닫힌다", async () => {
    const stream = createSseStream(async () => {
      throw new Error("boom");
    });
    // finally에서 close()하므로 정상 종료되어야 한다 — reject되지 않음
    const text = await readAll(stream);
    expect(text).toBe("");
  });

  it("외부 abort 뒤 producer가 늦게 enqueue해도 닫힌 controller 예외가 나지 않는다", async () => {
    const abortController = new AbortController();
    const stream = createSseStream(async (controller) => {
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      controller.enqueue(sseEvent("result", { late: true }));
    }, abortController.signal);

    const reader = stream.getReader();
    abortController.abort();
    const result = await reader.read();

    expect(result.done).toBe(true);
  });
});
