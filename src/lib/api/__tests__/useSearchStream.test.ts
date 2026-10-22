// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearchStream, type SearchStreamInput } from "../useSearchStream";
import { useSearchStore } from "@/store/search-store";
import { SEARCH_STEP_MIN_MS } from "@/lib/search-progress";
import type { WireSearchResult } from "@/app/api/_lib/types";

const BODY: SearchStreamInput = {
  origin: { lat: 37.42, lng: 127.12 },
  destination: { lat: 37.88, lng: 127.73 },
  fuel: "GASOLINE",
  filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
  vehicle: { efficiency: 10, refuelAmount: 45, timeValue: 200 },
  mode: "balanced",
  avoidHighway: false,
};

const RESULT: WireSearchResult = {
  searchId: "s-1",
  baseRoute: { distanceM: 92000, durationS: 5640, polyline: [] },
  candidates: [],
  referencePrice: 1800,
  refPriceSource: "MEDIAN_T1T2",
  expansion: { triggered: false, finalRadiusM: 3000 },
  warnings: [],
  stage: "ON_ROUTE",
  minutesNeededForOneResult: null,
};

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function controlledStream() {
  const encoder = new TextEncoder();
  let sink: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { sink = controller; },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send: (event: string, data: unknown) => sink.enqueue(encoder.encode(frame(event, data))),
    close: () => sink.close(),
  };
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

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
  vi.useFakeTimers();
  useSearchStore.setState({
    isLoading: false,
    isJsonFallback: false,
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

    expect(useSearchStore.getState().result).toBeNull();
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    await advance(SEARCH_STEP_MIN_MS);
    const state = useSearchStore.getState();
    expect(state.baseRoute?.distanceM).toBe(92000);
    expect(state.result?.searchId).toBe("s-1");
    expect(state.isLoading).toBe(false);
    expect(state.isJsonFallback).toBe(false);
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
  it("PRECISE가 이미 표시된 뒤 결과가 도착해도 남은 최소 시간을 취소하지 않는다", async () => {
    const source = controlledStream();
    source.send("progress", { step: "COLLECT" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(source.response));
    const { result } = renderHook(() => useSearchStream());
    let searchPromise: Promise<void>;
    await act(async () => { searchPromise = result.current.search(BODY); });
    await advance(SEARCH_STEP_MIN_MS);
    await act(async () => { source.send("progress", { step: "PRECISE" }); });
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    await advance(100);
    await act(async () => {
      source.send("result", RESULT);
      source.close();
      await searchPromise;
    });
    expect(useSearchStore.getState().result).toBeNull();
    await advance(SEARCH_STEP_MIN_MS - 101);
    expect(useSearchStore.getState().result).toBeNull();
    await advance(1);
    expect(useSearchStore.getState().result?.searchId).toBe("s-1");
  });

  it("서버가 준비 이벤트 없이 결과를 보내도 EXPAND를 만들지 않고 PRECISE로 마무리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseStreamResponse([
      frame("progress", { step: "COLLECT" }),
      frame("result", RESULT),
    ])));
    const { result } = renderHook(() => useSearchStream());
    await act(async () => { await result.current.search(BODY); });
    await advance(SEARCH_STEP_MIN_MS * 2);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    expect(useSearchStore.getState().result).toBeNull();
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().result?.searchId).toBe("s-1");
    expect(useSearchStore.getState().progressStepsSeen).toEqual(["ROUTE", "COLLECT", "PRECISE"]);
  });

  it("취소하면 대기 중인 결과와 진행 타이머가 이후 상태를 덮어쓰지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseStreamResponse([
      frame("progress", { step: "COLLECT" }),
      frame("result", RESULT),
    ])));
    const { result } = renderHook(() => useSearchStream());
    await act(async () => { await result.current.search(BODY); });
    act(() => { result.current.cancel(); });
    await advance(10_000);
    expect(useSearchStore.getState().result).toBeNull();
    expect(useSearchStore.getState().progressStepsSeen).toEqual(["ROUTE"]);
  });

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

    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("COLLECT");

    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("EXPAND");
    expect(useSearchStore.getState().expandRadiusM).toBe(14600);

    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    expect(useSearchStore.getState().result).toBeNull();

    await advance(SEARCH_STEP_MIN_MS - 1);
    expect(useSearchStore.getState().result).toBeNull();
    await advance(1);
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
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("COLLECT");
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    await advance(SEARCH_STEP_MIN_MS - 1);
    expect(useSearchStore.getState().result).toBeNull();
    await advance(1);

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
          'event: partial\ndata: {"candidates":[{"id":"A1"}],"baseRoutes":[{"priority":"TIME","route":{"distanceM":91000,"durationS":5500,"polyline":[]}}],"referencePrice":1800,"refPriceSource":"MEDIAN_T1T2","expansion":{"triggered":false,"finalRadiusM":3000}}\n\n',
          // result 없이 스트림 종료
        ]),
      ),
    );

    const { result } = renderHook(() => useSearchStream());
    await act(async () => {
      await result.current.search(BODY);
    });

    await advance(SEARCH_STEP_MIN_MS * 2);
    const state = useSearchStore.getState();
    expect(state.result?.candidates).toEqual([{ id: "A1" }]);
    expect(state.result?.baseRoutes).toEqual([
      { priority: "TIME", route: { distanceM: 91000, durationS: 5500, polyline: [] } },
    ]);
    expect(state.result?.warnings).toContainEqual(expect.objectContaining({ code: "TIMEOUT" }));
  });
});

describe("useSearchStream — JSON 폴백 (§6.2.1)", () => {
  it("JSON 응답이 오래 걸려도 PRECISE에서 출발점으로 되감지 않는다", async () => {
    let resolveJson: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn((_url: string, opts: RequestInit) => {
      if ((opts.headers as Record<string, string>).Accept === "text/event-stream") {
        return new Promise<Response>((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return new Promise<Response>((resolve) => { resolveJson = resolve; });
    }));
    const { result } = renderHook(() => useSearchStream());
    let pending: Promise<void>;
    await act(async () => { pending = result.current.search(BODY); });
    await advance(3_000 + 12_500);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    expect(useSearchStore.getState().progressStepsSeen).toEqual(["ROUTE", "COLLECT", "PRECISE"]);
    await act(async () => { resolveJson(Response.json(RESULT)); await pending; });
    expect(useSearchStore.getState().result?.searchId).toBe("s-1");
  });

  it.each(["cancel", "unmount"])("첫 프레임 이전 %s는 JSON 재요청을 발생시키지 않는다", async (action) => {
    const fetchMock = vi.fn((_url: string, opts: RequestInit) => new Promise<Response>((_resolve, reject) => {
      opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useSearchStream());
    let pending: Promise<void>;
    await act(async () => { pending = result.current.search(BODY); });
    await act(async () => {
      if (action === "cancel") result.current.cancel();
      else unmount();
      await pending;
    });
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().result).toBeNull();
  });

  it("이전 검색의 늦은 응답은 새 검색의 진행과 결과를 덮어쓰지 않는다", async () => {
    let resolveOld: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(sseStreamResponse([frame("result", { ...RESULT, searchId: "new" })]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSearchStream());
    let oldSearch: Promise<void>;
    await act(async () => { oldSearch = result.current.search(BODY); });
    await act(async () => { await result.current.search({ ...BODY, fuel: "DIESEL" }); });
    await act(async () => {
      resolveOld(sseStreamResponse([frame("result", { ...RESULT, searchId: "old" })]));
      await oldSearch;
    });
    await advance(SEARCH_STEP_MIN_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSearchStore.getState().result?.searchId).toBe("new");
  });

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
    expect(useSearchStore.getState().result).toBeNull();
    expect(useSearchStore.getState().isJsonFallback).toBe(true);
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().progressStep).toBe("PRECISE");
    await advance(SEARCH_STEP_MIN_MS);
    expect(useSearchStore.getState().result?.searchId).toBe("s-fallback");
    expect(useSearchStore.getState().isJsonFallback).toBe(false);
    expect(useSearchStore.getState().progressStepsSeen).not.toContain("EXPAND");
  });
});
