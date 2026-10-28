"use client";

/**
 * POST /api/search 소비 — ARCHITECTURE.md §6.2·§6.2.1, PRODUCT.md §10.2·§10.3.
 *
 * SSE 첫 프레임이 SSE_FIRST_EVENT_TIMEOUT_MS 안에 안 오면(인앱 브라우저 버퍼링)
 * 스트림을 끊고 JSON 폴백으로 1회 재시도합니다. 폴백 중에는 진행 문구를 시간 기반으로
 * 전환하되 `EXPAND`(범위를 넓히는 중)는 절대 보여주지 않습니다 — 확장 여부를 모르는
 * 채로 그 문구를 띄우면 "근거 없는 표시"가 됩니다.
 *
 * `EventSource`를 쓰지 않습니다 — 자동 재연결이 곧 파이프라인 재실행이라
 * 오피넷 예산을 조용히 잠식하기 때문입니다(§6.2). fetch + ReadableStream을 직접 읽습니다.
 *
 * 진행 단계(progress)는 큐에 쌓아 `SEARCH_STEP_MIN_MS`씩 노출합니다 — 서버가 여러 단계를
 * 연달아 flush해도 중간 단계가 배칭에 묻혀 건너뛰어지지 않도록. 큐에는 서버가
 * 실제로 보낸 단계와 결과 수신으로 확인된 마지막 결과 준비 단계만 들어갑니다.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSearchStore, type ProgressStep } from "@/store/search-store";
import { SEARCH_STEP_MIN_MS } from "@/lib/search-progress";
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
/** JSON 폴백일 때 시간 기반으로 전환하는 문구 — EXPAND 제외 (§6.2.1) */
const FALLBACK_STEP_CYCLE: ProgressStep[] = ["ROUTE", "COLLECT", "PRECISE"];
const FALLBACK_STEP_INTERVAL_MS = 2_500;

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
  const setJsonFallback = useSearchStore((s) => s.setJsonFallback);
  const setProgressStep = useSearchStore((s) => s.setProgressStep);
  const setBaseRoute = useSearchStore((s) => s.setBaseRoute);
  const setPartial = useSearchStore((s) => s.setPartial);
  const pushWarning = useSearchStore((s) => s.pushWarning);
  const setResult = useSearchStore((s) => s.setResult);
  const setError = useSearchStore((s) => s.setError);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── 진행 단계 페이서 ────────────────────────────────────────────────────
  // 도착한 단계를 큐에 쌓고, 현재 단계의 이동까지 끝난 뒤 다음 단계/결과로 넘긴다.
  const stepQueueRef = useRef<{ step: ProgressStep; radiusM?: number }[]>([]);
  const displayedStepRef = useRef<ProgressStep | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 스트림이 끝났지만 아직 못 보여준 단계가 큐에 남아있을 때, 큐를 다 비운 뒤 실행할 마무리 */
  const afterStepsRef = useRef<(() => void) | null>(null);

  const resetPacer = useCallback(() => {
    if (stepTimerRef.current != null) {
      clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    stepQueueRef.current = [];
    displayedStepRef.current = null;
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
    displayedStepRef.current = next.step;
    setProgressStep(next.step, next.radiusM);
    stepTimerRef.current = setTimeout(() => {
      stepTimerRef.current = null;
      pumpSteps();
    }, SEARCH_STEP_MIN_MS);
  }, [setProgressStep]);

  const enqueueStep = useCallback(
    (step: ProgressStep, radiusM?: number) => {
      const lastStep = stepQueueRef.current.at(-1)?.step ?? displayedStepRef.current;
      if (lastStep === step) return;
      stepQueueRef.current.push({ step, radiusM });
      pumpSteps();
    },
    [pumpSteps],
  );

  /** 성공 결과가 있으면 준비 단계가 확정된다. 마지막 단계의 최소 시간도 반드시 지킨다. */
  const finishAfterSteps = useCallback(
    (done: () => void) => {
      enqueueStep("PRECISE");
      afterStepsRef.current = done;
      pumpSteps();
    },
    [enqueueStep, pumpSteps],
  );

  const stopFallbackCycle = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      stopFallbackCycle();
      resetPacer();
    };
  }, [stopFallbackCycle, resetPacer]);

  const runJsonFallback = useCallback(
    async (body: SearchStreamInput, requestId: number) => {
      resetPacer(); // 폴백은 자체 시간 순환을 쓴다 — 스트림이 남긴 큐/타이머 정리
      setJsonFallback(true);
      const fallbackController = new AbortController();
      abortRef.current = fallbackController;
      let i = 0;
      enqueueStep(FALLBACK_STEP_CYCLE[0]);
      fallbackTimerRef.current = setInterval(() => {
        i += 1;
        enqueueStep(FALLBACK_STEP_CYCLE[i]);
        if (i === FALLBACK_STEP_CYCLE.length - 1) stopFallbackCycle();
      }, FALLBACK_STEP_INTERVAL_MS);

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: fallbackController.signal,
        });
        if (requestId !== requestIdRef.current || fallbackController.signal.aborted) return;
        if (!res.ok) {
          const error = await readErrorBody(res);
          if (requestId !== requestIdRef.current || fallbackController.signal.aborted) return;
          resetPacer();
          setError(error);
          return;
        }
        const result = (await res.json()) as WireSearchResult;
        if (requestId !== requestIdRef.current || fallbackController.signal.aborted) return;
        finishAfterSteps(() => {
          if (requestId === requestIdRef.current) setResult(result);
        });
      } catch (err) {
        if (requestId !== requestIdRef.current || isAbortError(err)) return;
        resetPacer();
        setError({ code: "NETWORK_ERROR", message: "검색 중 문제가 발생했습니다." });
      } finally {
        if (requestId === requestIdRef.current) stopFallbackCycle();
      }
    },
    [setJsonFallback, enqueueStep, setResult, setError, stopFallbackCycle, resetPacer, finishAfterSteps],
  );

  const search = useCallback(
    async (body: SearchStreamInput) => {
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      stopFallbackCycle();
      resetPacer();
      const controller = new AbortController();
      abortRef.current = controller;

      startSearch();
      enqueueStep("ROUTE");

      let gotFirstByte = false;
      let lastBaseRoute: WireBaseRoute | null = null;
      let lastPartial: WirePartial | null = null;
      let finished = false;
      let firstEventTimedOut = false;

      const firstByteTimeout = setTimeout(() => {
        if (!gotFirstByte) {
          firstEventTimedOut = true;
          controller.abort();
        }
      }, SSE_FIRST_EVENT_TIMEOUT_MS);

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;

        if (!res.ok) {
          gotFirstByte = true;
          const error = await readErrorBody(res);
          if (requestId !== requestIdRef.current || controller.signal.aborted) return;
          resetPacer();
          setError(error);
          return;
        }
        if (!res.body) throw new Error("스트림 응답에 body가 없습니다.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (requestId !== requestIdRef.current || controller.signal.aborted) return;
          if (done) break;
          gotFirstByte = true;
          clearTimeout(firstByteTimeout);

          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSseFrames(buffer);
          buffer = rest;

          for (const frame of frames) {
            if (finished) break;
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
                finishAfterSteps(() => {
                  if (requestId === requestIdRef.current) setResult(data);
                });
                break;
              }
              case "error": {
                const data = frame.data as { code: string; message: string };
                finished = true;
                resetPacer();
                setError(data);
                break;
              }
            }
          }
          if (finished) {
            // 최종 프레임을 받았으므로 전송 정리 실패가 확정 결과를 덮어쓰지 않게 한다.
            void reader.cancel().catch(() => undefined);
            break;
          }
        }

        // 스트림이 result/error 없이 끊김 — 마지막 partial로 마무리 (§10.2)
        if (!finished) {
          if (lastPartial && lastBaseRoute) {
            const synthesized: WireSearchResult = {
              searchId: crypto.randomUUID(),
              baseRoute: lastBaseRoute,
              candidates: lastPartial.candidates,
              // 새 partial은 실제 비교한 경로를 보존하고, 구버전 partial은 RECOMMEND로 폴백한다.
              baseRoutes: lastPartial.baseRoutes ?? [
                { priority: "RECOMMEND", route: lastBaseRoute },
              ],
              referencePrice: lastPartial.referencePrice,
              refPriceSource: lastPartial.refPriceSource,
              expansion: lastPartial.expansion,
              warnings: [{ code: "TIMEOUT", message: "일부 계산이 완료되지 않았습니다." }],
              // partial은 STAGE 2의 추정 후보를 담는다. STAGE 1도 후보별 경유 호출 없이 result를 만든다.
              stage: "DETOUR",
              minutesNeededForOneResult: null,
            };
            finishAfterSteps(() => {
              if (requestId === requestIdRef.current) setResult(synthesized);
            });
          } else {
            resetPacer();
            setError({ code: "TIMEOUT", message: "일부 계산이 완료되지 않았습니다." });
          }
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        if (firstEventTimedOut && !gotFirstByte) {
          await runJsonFallback(body, requestId);
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
    requestIdRef.current += 1;
    abortRef.current?.abort();
    stopFallbackCycle();
    resetPacer();
  }, [stopFallbackCycle, resetPacer]);

  return { search, cancel };
}
