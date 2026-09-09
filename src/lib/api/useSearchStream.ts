"use client";

/**
 * POST /api/search 소비 — ARCHITECTURE.md §6.2·§6.2.1, PRODUCT.md §10.2·§10.3.
 *
 * SSE 첫 프레임이 SSE_FIRST_EVENT_TIMEOUT_MS 안에 안 오면(인앱 브라우저 버퍼링)
 * 스트림을 끊고 JSON 폴백으로 1회 재시도합니다. 폴백 중에는 진행 문구를 시간 기반으로
 * 순환시키되 `EXPAND`(범위를 넓히는 중)는 절대 보여주지 않습니다 — 확장 여부를 모르는
 * 채로 그 문구를 띄우면 "근거 없는 표시"가 됩니다.
 *
 * `EventSource`를 쓰지 않습니다 — 자동 재연결이 곧 파이프라인 재실행이라
 * 오피넷 예산을 조용히 잠식하기 때문입니다(§6.2). fetch + ReadableStream을 직접 읽습니다.
 *
 * 진행 단계(progress)는 큐에 쌓아 `MIN_STEP_MS`씩 노출합니다 — 서버가 여러 단계를
 * 연달아 flush해도 중간 단계가 배칭에 묻혀 건너뛰어지지 않도록. 큐에는 서버가
 * 실제로 보낸 단계만 들어갑니다.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSearchStore, type ProgressStep } from "@/store/search-store";
import { parseSseFrames } from "./sse-client";
import type {
  Fuel,
  Mode,
  WireFilters,
  WireVehicle,
  WirePoint,
  WireBaseRoute,
  WireSearchResult,
  WirePartial,
  WireWarning,
} from "@/app/api/_lib/types";

const SSE_FIRST_EVENT_TIMEOUT_MS = 3_000;
/** JSON 폴백일 때 시간 기반으로 순환시키는 문구 — EXPAND 제외 (§6.2.1) */
const FALLBACK_STEP_CYCLE: ProgressStep[] = ["ROUTE", "COLLECT", "PRECISE"];
const FALLBACK_STEP_INTERVAL_MS = 2_500;
/** 진행 단계 하나가 화면에 유지되는 최소 시간 — 다음 단계가 이보다 빨리 와도 대기 */
const MIN_STEP_MS = 700;

export interface SearchStreamInput {
  origin: WirePoint;
  destination: WirePoint;
  fuel: Fuel;
  filters: WireFilters;
  vehicle: WireVehicle;
  mode: Mode;
  avoidHighway: boolean;
  /** 사용자가 접힌 우회 섹션을 펼쳤는가 — STAGE 2 실행 여부 (PRODUCT.md §6.6) */
  includeDetour?: boolean;
  /** "우회 허용 시간"(분). 표시 필터가 아니라 검색 파라미터 (AGENTS.md 불변식 8) */
  maxDetourMinutes?: number;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function readErrorBody(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    return { code: body.code ?? "INTERNAL_ERROR", message: body.message ?? "검색 중 오류가 발생했습니다." };
  } catch {
    return { code: "INTERNAL_ERROR", message: "검색 중 오류가 발생했습니다." };
  }
}

/** 같은 서비스, 다른 출구(§6.2.1) — 서버 로직과 대칭되는 클라이언트 쪽 두 경로. */
export function useSearchStream() {
  const startSearch = useSearchStore((s) => s.startSearch);
  const setProgressStep = useSearchStore((s) => s.setProgressStep);
  const setBaseRoute = useSearchStore((s) => s.setBaseRoute);
  const setPartial = useSearchStore((s) => s.setPartial);
  const pushWarning = useSearchStore((s) => s.pushWarning);
  const setResult = useSearchStore((s) => s.setResult);
  const setError = useSearchStore((s) => s.setError);

  const abortRef = useRef<AbortController | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── 진행 단계 페이서 ────────────────────────────────────────────────────
  // 도착한 단계를 큐에 쌓고, 각 단계를 MIN_STEP_MS 이상 노출한 뒤 다음으로 넘긴다.
  const stepQueueRef = useRef<{ step: ProgressStep; radiusM?: number }[]>([]);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 스트림이 끝났지만 아직 못 보여준 단계가 큐에 남아있을 때, 큐를 다 비운 뒤 실행할 마무리 */
  const afterStepsRef = useRef<(() => void) | null>(null);

  const resetPacer = useCallback(() => {
    if (stepTimerRef.current != null) {
      clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    stepQueueRef.current = [];
    afterStepsRef.current = null;
  }, []);

  const pumpSteps = useCallback(() => {
    if (stepTimerRef.current != null) return; // 현재 단계가 최소 시간 노출 중
    const next = stepQueueRef.current.shift();
    if (!next) {
      const done = afterStepsRef.current;
      afterStepsRef.current = null;
      done?.();
      return;
    }
    setProgressStep(next.step, next.radiusM);
    stepTimerRef.current = setTimeout(() => {
      stepTimerRef.current = null;
      pumpSteps();
    }, MIN_STEP_MS);
  }, [setProgressStep]);

  const enqueueStep = useCallback(
    (step: ProgressStep, radiusM?: number) => {
      stepQueueRef.current.push({ step, radiusM });
      pumpSteps();
    },
    [pumpSteps],
  );

  /** 스트림 종료(result/error) — 큐에 안 보여준 단계가 남아있으면 다 보여준 뒤 실행 */
  const finishAfterSteps = useCallback((done: () => void) => {
    if (stepQueueRef.current.length === 0) {
      if (stepTimerRef.current != null) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      done();
    } else {
      afterStepsRef.current = done;
    }
  }, []);

  const stopFallbackCycle = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopFallbackCycle();
      resetPacer();
    };
  }, [stopFallbackCycle, resetPacer]);

  const runJsonFallback = useCallback(
    async (body: SearchStreamInput, signal: AbortSignal) => {
      resetPacer(); // 폴백은 자체 시간 순환을 쓴다 — 스트림이 남긴 큐/타이머 정리
      let i = 0;
      setProgressStep(FALLBACK_STEP_CYCLE[0]);
      fallbackTimerRef.current = setInterval(() => {
        i = (i + 1) % FALLBACK_STEP_CYCLE.length;
        setProgressStep(FALLBACK_STEP_CYCLE[i]);
      }, FALLBACK_STEP_INTERVAL_MS);

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          setError(await readErrorBody(res));
          return;
        }
        const result = (await res.json()) as WireSearchResult;
        setResult(result);
      } catch (err) {
        if (isAbortError(err)) return;
        setError({ code: "NETWORK_ERROR", message: "검색 중 문제가 발생했습니다." });
      } finally {
        stopFallbackCycle();
      }
    },
    [setProgressStep, setResult, setError, stopFallbackCycle, resetPacer],
  );

  const search = useCallback(
    async (body: SearchStreamInput) => {
      abortRef.current?.abort();
      stopFallbackCycle();
      resetPacer();
      const controller = new AbortController();
      abortRef.current = controller;

      startSearch();

      let gotFirstByte = false;
      let lastBaseRoute: WireBaseRoute | null = null;
      let lastPartial: WirePartial | null = null;
      let finished = false;

      const firstByteTimeout = setTimeout(() => {
        if (!gotFirstByte) controller.abort();
      }, SSE_FIRST_EVENT_TIMEOUT_MS);

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          gotFirstByte = true;
          setError(await readErrorBody(res));
          return;
        }
        if (!res.body) throw new Error("스트림 응답에 body가 없습니다.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          gotFirstByte = true;
          clearTimeout(firstByteTimeout);

          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSseFrames(buffer);
          buffer = rest;

          for (const frame of frames) {
            switch (frame.event) {
              case "progress": {
                const progress = frame.data as { step: ProgressStep; radiusM?: number };
                enqueueStep(progress.step, progress.radiusM);
                break;
              }
              case "base_route":
                lastBaseRoute = frame.data as WireBaseRoute;
                setBaseRoute(lastBaseRoute);
                break;
              case "partial":
                lastPartial = frame.data as WirePartial;
                setPartial(lastPartial);
                break;
              case "warning":
                pushWarning(frame.data as WireWarning);
                break;
              case "result": {
                const data = frame.data as WireSearchResult;
                finished = true;
                finishAfterSteps(() => setResult(data));
                break;
              }
              case "error": {
                const data = frame.data as { code: string; message: string };
                finished = true;
                finishAfterSteps(() => setError(data));
                break;
              }
            }
          }
        }

        // 스트림이 result/error 없이 끊김 — 마지막 partial로 마무리 (§10.2)
        if (!finished) {
          if (lastPartial && lastBaseRoute) {
            const synthesized: WireSearchResult = {
              searchId: crypto.randomUUID(),
              baseRoute: lastBaseRoute,
              candidates: lastPartial.candidates,
              referencePrice: lastPartial.referencePrice,
              refPriceSource: lastPartial.refPriceSource,
              expansion: lastPartial.expansion,
              warnings: [{ code: "TIMEOUT", message: "일부 계산이 완료되지 않았습니다." }],
              // partial은 STAGE 2에서만 방출된다 — STAGE 1은 실측을 마치고 곧장 result다.
              stage: "DETOUR",
              minutesNeededForOneResult: null,
            };
            finishAfterSteps(() => setResult(synthesized));
          } else {
            finishAfterSteps(() => setError({ code: "TIMEOUT", message: "일부 계산이 완료되지 않았습니다." }));
          }
        }
      } catch (err) {
        if (controller.signal.aborted && !gotFirstByte) {
          await runJsonFallback(body, controller.signal);
        } else if (!isAbortError(err)) {
          resetPacer(); // 남은 큐가 에러 화면 위에 진행 문구를 덮어쓰지 않게
          setError({ code: "NETWORK_ERROR", message: "검색 중 문제가 발생했습니다." });
        }
      } finally {
        clearTimeout(firstByteTimeout);
      }
    },
    [
      startSearch,
      setBaseRoute,
      setPartial,
      pushWarning,
      setResult,
      setError,
      runJsonFallback,
      stopFallbackCycle,
      resetPacer,
      enqueueStep,
      finishAfterSteps,
    ],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    stopFallbackCycle();
    resetPacer();
  }, [stopFallbackCycle, resetPacer]);

  return { search, cancel };
}
