/**
 * 검색 — ARCHITECTURE.md §6.2·§6.2.1·§10 Phase 8.
 * SSE(text/event-stream)와 JSON 폴백(application/json)이 recommendation-service.search()
 * 하나를 콜백 유무로만 다르게 호출합니다 — "같은 서비스, 다른 출구". 로직을 복제하지 않습니다.
 */

import { NextResponse } from "next/server";
import { search, type ProgressEvent } from "@/services/recommendation-service";
import { wgs84 } from "@/domain/types";
import type { SearchInput } from "@/domain/types";
import { SearchRequestSchema, type SearchRequest } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { serializeBaseRoute, serializeCandidates, serializeSearchResult } from "@/app/api/_lib/serialize";
import { createSseStream, sseEvent, SSE_HEADERS } from "@/app/api/_lib/sse";

// §5.4 전체 처리 시간 상한 12초 + 여유. 폭주 방지용 상한(§10 Phase 8 완료 기준).
export const maxDuration = 20;

function toSearchInput(body: SearchRequest): SearchInput {
  return {
    origin: wgs84(body.origin.lat, body.origin.lng),
    destination: wgs84(body.destination.lat, body.destination.lng),
    vehicle: {
      fuel: body.fuel,
      efficiencyKmPerL: body.vehicle.efficiency,
      refuelAmountL: body.vehicle.refuelAmount,
      timeValuePerMin: body.vehicle.timeValue,
    },
    filters: body.filters,
    mode: body.mode,
    avoidHighway: body.avoidHighway,
  };
}

function progressFrame(event: ProgressEvent): string {
  switch (event.type) {
    case "progress":
      return sseEvent("progress", { step: event.step, radiusM: event.radiusM });
    case "base_route":
      return sseEvent("base_route", serializeBaseRoute(event.data));
    case "partial":
      return sseEvent("partial", {
        candidates: serializeCandidates(event.data.candidates),
        referencePrice: event.data.referencePrice,
        refPriceSource: event.data.refPriceSource,
        expansion: event.data.expansion,
      });
    case "warning":
      return sseEvent("warning", event.data);
  }
}

function errorPayload(err: unknown): { code: string; message: string } {
  console.error("[POST /api/search] search() 실패:", err);
  return { code: "INTERNAL_ERROR", message: "검색 중 오류가 발생했습니다." };
}

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, SearchRequestSchema);
  if (!parsed.ok) return parsed.response;
  const input = toSearchInput(parsed.data);

  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

  if (wantsJson) {
    try {
      const result = await search(input);
      return NextResponse.json(serializeSearchResult(result));
    } catch (err) {
      const { code, message } = errorPayload(err);
      return NextResponse.json({ code, message }, { status: 500 });
    }
  }

  const stream = createSseStream(async (controller) => {
    try {
      const result = await search(input, (event) => controller.enqueue(progressFrame(event)));
      controller.enqueue(sseEvent("result", serializeSearchResult(result)));
    } catch (err) {
      controller.enqueue(sseEvent("error", errorPayload(err)));
    }
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
