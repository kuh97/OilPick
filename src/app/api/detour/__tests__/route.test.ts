import { describe, expect, it, vi } from "vitest";

const getRouteMock = vi.fn();
vi.mock("@/services/route-service", () => ({ getRoute: (...args: unknown[]) => getRouteMock(...args) }));

const findRefuelPointsByIdsMock = vi.fn();
vi.mock("@/infra/db/repositories", () => ({
  findRefuelPointsByIds: (...args: unknown[]) => findRefuelPointsByIdsMock(...args),
}));

import { POST } from "../route";
import { wgs84 } from "@/domain/types";
import type { RefuelPoint } from "@/domain/types";

function station(): RefuelPoint {
  return {
    id: "A0012345",
    name: "테스트주유소",
    brandCode: "SKE",
    energyType: "OIL",
    location: wgs84(37.6, 127.4),
    facilities: { carWash: false, maintenance: false, cvs: false },
    isKpetro: false,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    origin: { lat: 37.42, lng: 127.12 },
    destination: { lat: 37.88, lng: 127.73 },
    stationId: "A0012345",
    vehicle: { efficiency: 8.5, refuelAmount: 45, timeValue: 200 },
    priceStation: 1650,
    referencePrice: 1210,
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request("https://example.com/api/detour", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/detour — 요청 검증", () => {
  it("priceStation이 없으면 400이다", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).priceStation;
    const res = await POST(request(body));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/detour — 주유소 없음", () => {
  it("stationId를 찾지 못하면 404다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([]);
    const res = await POST(request(validBody()));
    expect(res.status).toBe(404);
    expect(getRouteMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/detour — 정상 흐름", () => {
  it("기본 경로와 경유 경로 차이로 distanceM·durationS를 계산하고 netSaving을 반환한다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock
      .mockResolvedValueOnce({ distanceM: 92000, durationS: 5640, polyline: [] }) // base
      .mockResolvedValueOnce({ distanceM: 104400, durationS: 6720, polyline: [wgs84(37.5, 127.3)] }); // via

    const res = await POST(request(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distanceM).toBe(12400);
    expect(body.durationS).toBe(1080);
    expect(body.precise).toBe(true);
    // netSaving = (1210-1650)*45 - (12400/1000/8.5)*1650 ≈ -19800 - 2408 = -22208
    expect(body.netSaving).toBeLessThan(0);
    // 지도에 경유 경로를 그리려면 폴리라인이 필요하다 — via route에서 그대로 뽑아 응답한다
    expect(body.polyline).toEqual([{ lat: 37.5, lng: 127.3 }]);
  });

  it("기본·경유 경로에 통행료가 있으면 차액을 tollWon으로 반환한다 (netSaving엔 미반영)", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock
      .mockResolvedValueOnce({ distanceM: 92000, durationS: 5640, tollWon: 1000, polyline: [] }) // base
      .mockResolvedValueOnce({ distanceM: 104400, durationS: 6720, tollWon: 3900, polyline: [] }); // via

    const res = await POST(request(validBody()));
    const body = await res.json();
    expect(body.tollWon).toBe(2900);
  });

  it("통행료 정보가 없으면 tollWon을 아예 내려주지 않는다 (0원으로 단정하지 않음)", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock
      .mockResolvedValueOnce({ distanceM: 92000, durationS: 5640, polyline: [] })
      .mockResolvedValueOnce({ distanceM: 104400, durationS: 6720, polyline: [] });

    const res = await POST(request(validBody()));
    const body = await res.json();
    expect(body.tollWon).toBeUndefined();
  });

  it("avoidHighway를 기본 경로·경유 경로 양쪽 getRoute 호출에 그대로 전달한다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock
      .mockResolvedValueOnce({ distanceM: 92000, durationS: 5640, polyline: [] })
      .mockResolvedValueOnce({ distanceM: 104400, durationS: 6720, polyline: [] });

    await POST(request(validBody({ avoidHighway: true })));

    const lastTwoCalls = getRouteMock.mock.calls.slice(-2);
    expect(lastTwoCalls).toHaveLength(2);
    for (const [opts] of lastTwoCalls) {
      expect(opts.avoidHighway).toBe(true);
    }
  });

  it("경유 경로 조회가 실패하면 502를 반환한다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock.mockRejectedValue(new Error("kakao 500"));

    const res = await POST(request(validBody()));
    expect(res.status).toBe(502);
  });
});
