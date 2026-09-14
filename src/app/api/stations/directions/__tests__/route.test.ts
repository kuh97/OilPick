import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteMock = vi.fn();
vi.mock("@/services/route-service", () => ({
  getRoute: (...args: unknown[]) => getRouteMock(...args),
}));

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

function request(body: unknown) {
  return new Request("https://example.com/api/stations/directions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    stationId: "A0012345",
    origin: { lat: 37.42, lng: 127.12 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/stations/directions", () => {
  it("stationId 또는 origin이 없으면 400이다", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).stationId;

    const res = await POST(request(body));

    expect(res.status).toBe(400);
    expect(findRefuelPointsByIdsMock).not.toHaveBeenCalled();
  });

  it("주유소가 없으면 404이고 길찾기를 호출하지 않는다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([]);

    const res = await POST(request(validBody()));

    expect(res.status).toBe(404);
    expect(getRouteMock).not.toHaveBeenCalled();
  });

  it("DB 주유소 좌표를 목적지로 카카오 경로를 조회하고 WireBaseRoute를 반환한다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock.mockResolvedValue({
      distanceM: 3200,
      durationS: 480,
      tollWon: 0,
      polyline: [wgs84(37.42, 127.12), wgs84(37.6, 127.4)],
    });

    const res = await POST(request(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getRouteMock).toHaveBeenCalledWith({
      origin: wgs84(37.42, 127.12),
      destination: station().location,
    });
    expect(body).toEqual({
      distanceM: 3200,
      durationS: 480,
      tollWon: 0,
      polyline: [
        { lat: 37.42, lng: 127.12 },
        { lat: 37.6, lng: 127.4 },
      ],
    });
  });

  it("카카오 경로 조회가 실패하면 502다", async () => {
    findRefuelPointsByIdsMock.mockResolvedValue([station()]);
    getRouteMock.mockRejectedValue(new Error("kakao 500"));

    const res = await POST(request(validBody()));

    expect(res.status).toBe(502);
  });
});
