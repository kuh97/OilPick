import { describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("@/services/recommendation-service", () => ({
  search: (...args: unknown[]) => searchMock(...args),
}));

import { POST } from "../route";
import { wgs84 } from "@/domain/types";
import type { SearchResult } from "@/domain/types";

function validBody() {
  return {
    origin: { lat: 37.42, lng: 127.12, name: "성남시청" },
    destination: { lat: 37.88, lng: 127.73, name: "춘천역" },
    fuel: "LPG",
    filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
    vehicle: { efficiency: 8.5, refuelAmount: 45, timeValue: 200 },
    mode: "balanced",
  };
}

function request(body: unknown, accept?: string) {
  return new Request("https://example.com/api/search", {
    method: "POST",
    headers: accept ? { accept } : {},
    body: JSON.stringify(body),
  });
}

function fakeResult(): SearchResult {
  return {
    searchId: "s-1",
    baseRoute: { distanceM: 92000, durationS: 5640, polyline: [wgs84(37.42, 127.12)] },
    candidates: [],
    referencePrice: 1800,
    refPriceSource: "MEDIAN_T1T2",
    expansion: { triggered: false, finalRadiusM: 3000 },
    warnings: [],
  };
}

async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

function eventTypes(sseText: string): string[] {
  return [...sseText.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
}

describe("POST /api/search — 요청 검증", () => {
  it("바디가 스키마에 안 맞으면 400과 INVALID_REQUEST를 반환한다", async () => {
    const res = await POST(request({ origin: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_REQUEST");
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/search — Accept: application/json 폴백", () => {
  it("콜백 없이 search()를 호출하고 완성된 SearchResult를 반환한다", async () => {
    searchMock.mockResolvedValue(fakeResult());
    const res = await POST(request(validBody(), "application/json"));

    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0][1]).toBeUndefined(); // onProgress 없음

    const body = await res.json();
    expect(body.searchId).toBe("s-1");
    expect(body.baseRoute.polyline).toEqual([{ lat: 37.42, lng: 127.12 }]);
  });

  it("avoidHighway를 생략하면 false로 기본값이 채워져 search()에 전달된다", async () => {
    searchMock.mockResolvedValue(fakeResult());
    await POST(request(validBody(), "application/json"));
    expect(searchMock.mock.calls.at(-1)![0].avoidHighway).toBe(false);
  });

  it("avoidHighway: true를 그대로 search()에 전달한다", async () => {
    searchMock.mockResolvedValue(fakeResult());
    await POST(request({ ...validBody(), avoidHighway: true }, "application/json"));
    expect(searchMock.mock.calls.at(-1)![0].avoidHighway).toBe(true);
  });

  it("에러는 500을 반환한다", async () => {
    searchMock.mockRejectedValue(new Error("boom"));
    const res = await POST(request(validBody(), "application/json"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});

describe("POST /api/search — SSE (기본)", () => {
  it("base_route가 최초, result가 최종 이벤트다", async () => {
    searchMock.mockImplementation(async (_input, onProgress) => {
      onProgress?.({ type: "progress", step: "ROUTE" });
      onProgress?.({ type: "base_route", data: { distanceM: 92000, durationS: 5640, polyline: [] } });
      onProgress?.({ type: "progress", step: "COLLECT" });
      return fakeResult();
    });

    const res = await POST(request(validBody()));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await readSse(res);
    const types = eventTypes(text);
    expect(types[0]).toBe("progress");
    expect(types[1]).toBe("base_route");
    expect(types[types.length - 1]).toBe("result");
  });

  it("에러 발생 시 error 이벤트 이후 더 이상 이벤트가 없다(스트림 종료)", async () => {
    searchMock.mockImplementation(async (_input, onProgress) => {
      onProgress?.({ type: "progress", step: "ROUTE" });
      throw new Error("boom");
    });

    const res = await POST(request(validBody()));
    const text = await readSse(res);
    const types = eventTypes(text);

    expect(types[types.length - 1]).toBe("error");
    expect(types).not.toContain("result");
    expect(text).toContain("INTERNAL_ERROR");
  });
});

describe("POST /api/search — SSE result와 JSON 폴백 본문 동일성 (§10 Phase 8 완료 기준)", () => {
  it("같은 SearchResult라면 SSE의 result 데이터와 JSON 폴백 응답 본문이 같다", async () => {
    searchMock.mockResolvedValue(fakeResult());

    const jsonRes = await POST(request(validBody(), "application/json"));
    const jsonBody = await jsonRes.json();

    const sseRes = await POST(request(validBody()));
    const sseText = await readSse(sseRes);
    const resultLine = sseText.split("\n\n").find((frame) => frame.startsWith("event: result"))!;
    const sseData = JSON.parse(resultLine.split("\ndata: ")[1]);

    expect(sseData).toEqual(jsonBody);
  });
});
