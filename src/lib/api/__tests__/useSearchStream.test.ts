// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearchStream, type SearchStreamInput } from "../useSearchStream";
import { useSearchStore } from "@/store/search-store";

const BODY: SearchStreamInput = {
  origin: { lat: 37.42, lng: 127.12 },
  destination: { lat: 37.88, lng: 127.73 },
  fuel: "GASOLINE",
  filters: { facilities: [], brands: [], kpetroOnly: false },
  vehicle: { efficiency: 10, refuelAmount: 45, timeValue: 200 },
  mode: "balanced",
};

function sseStreamResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  useSearchStore.setState({
    isLoading: false,
    progressStep: null,
    progressStepsSeen: [],
    expandRadiusM: null,
    baseRoute: null,
    partial: null,
    result: null,
    streamWarnings: [],
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSearchStream — SSE 정상 흐름", () => {
  it("progress·base_route·partial·result 프레임을 순서대로 스토어에 반영한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseStreamResponse([
          'event: progress\ndata: {"step":"ROUTE"}\n\n',
          'event: base_route\ndata: {"distanceM":92000,"durationS":5640,"polyline":[]}\n\n',
          'event: partial\ndata: {"candidates":[],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":false,"finalRadiusM":3000}}\n\n',
          'event: result\ndata: {"searchId":"s-1","baseRoute":{"distanceM":92000,"durationS":5640,"polyline":[]},"candidates":[],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":false,"finalRadiusM":3000},"warnings":[]}\n\n',
        ]),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });

    const state = useSearchStore.getState();
    expect(state.baseRoute?.distanceM).toBe(92000);
    expect(state.result?.searchId).toBe("s-1");
    expect(state.isLoading).toBe(false);
  });

  it("error 프레임이 오면 setError로 반영되고 result는 없다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseStreamResponse(['event: error\ndata: {"code":"INTERNAL_ERROR","message":"검색 중 오류가 발생했습니다."}\n\n']),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });

    const state = useSearchStore.getState();
    expect(state.error?.code).toBe("INTERNAL_ERROR");
    expect(state.result).toBeNull();
  });
});

describe("useSearchStream — 진행 단계 페이싱", () => {
  it("EXPAND·PRECISE·result가 한꺼번에 도착해도 각 단계를 최소 시간만큼 노출한다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseStreamResponse([
          'event: progress\ndata: {"step":"ROUTE"}\n\n',
          'event: progress\ndata: {"step":"COLLECT"}\n\n',
          'event: progress\ndata: {"step":"EXPAND","radiusM":14600}\n\n',
          'event: partial\ndata: {"candidates":[],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":true,"finalRadiusM":14600}}\n\n',
          'event: progress\ndata: {"step":"PRECISE"}\n\n',
          'event: result\ndata: {"searchId":"s-exp","baseRoute":{"distanceM":9000,"durationS":900,"polyline":[]},"candidates":[],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":true,"finalRadiusM":14600},"warnings":[]}\n\n',
        ]),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });

    // 프레임은 모두 소비됐지만, 첫 단계만 보이고 결과는 아직 대기 중이어야 한다.
    expect(useSearchStore.getState().progressStep).toBe("ROUTE");
    expect(useSearchStore.getState().result).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(useSearchStore.getState().progressStep).toBe("COLLECT");

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(useSearchStore.getState().progressStep).toBe("EXPAND");
    expect(useSearchStore.getState().expandRadiusM).toBe(14600);

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    expect(useSearchStore.getState().result).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(useSearchStore.getState().result?.searchId).toBe("s-exp");
    expect(useSearchStore.getState().isLoading).toBe(false);
    expect(useSearchStore.getState().progressStepsSeen).toContain("EXPAND");
  });

  it("확장이 없으면 EXPAND 단계는 큐에 들어가지 않는다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseStreamResponse([
          'event: progress\ndata: {"step":"ROUTE"}\n\n',
          'event: progress\ndata: {"step":"COLLECT"}\n\n',
          'event: progress\ndata: {"step":"PRECISE"}\n\n',
          'event: result\ndata: {"searchId":"s-noexp","baseRoute":{"distanceM":90000,"durationS":5000,"polyline":[]},"candidates":[],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":false,"finalRadiusM":3000},"warnings":[]}\n\n',
        ]),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(useSearchStore.getState().result?.searchId).toBe("s-noexp");
    expect(useSearchStore.getState().progressStepsSeen).not.toContain("EXPAND");
  });
});

describe("useSearchStream — 스트림이 result 없이 끊김 (§10.2)", () => {
  it("마지막 partial과 base_route로 결과를 합성하고 TIMEOUT 경고를 남긴다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseStreamResponse([
          'event: base_route\ndata: {"distanceM":92000,"durationS":5640,"polyline":[]}\n\n',
          'event: partial\ndata: {"candidates":[{"id":"A1"}],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":false,"finalRadiusM":3000}}\n\n',
          // result 없이 스트림 종료
        ]),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });

    const state = useSearchStore.getState();
    expect(state.result?.candidates).toEqual([{ id: "A1" }]);
    expect(state.result?.warnings).toContainEqual(expect.objectContaining({ code: "TIMEOUT" }));
  });
});

describe("useSearchStream — JSON 폴백 (§6.2.1)", () => {
  it("3초 내 첫 바이트가 없으면 스트림을 끊고 JSON으로 재요청한다", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts: RequestInit) => {
        call++;
        if (call === 1) {
          // 인앱 브라우저 버퍼링 상황 재현 — 응답이 영원히 안 옴. abort되면 reject.
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        }
        expect(opts.headers).toMatchObject({ Accept: "application/json" });
        return Promise.resolve(
          new Response(JSON.stringify({ searchId: "s-fallback", candidates: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      const searchPromise = result.current.search(BODY);
      await vi.advanceTimersByTimeAsync(3_000);
      await searchPromise;
    });

    expect(call).toBe(2);
    expect(useSearchStore.getState().result?.searchId).toBe("s-fallback");
  });
});
