import { describe, expect, it, vi } from "vitest";

const collectStationsMock = vi.fn();
vi.mock("@/services/station-service", () => ({
  collectStations: (...args: unknown[]) => collectStationsMock(...args),
}));

import { GET } from "../route";
import { wgs84 } from "@/domain/types";
import type { RefuelPoint } from "@/domain/types";

function station(overrides: Partial<RefuelPoint> = {}): RefuelPoint {
  return {
    id: "A0000001",
    name: "가까운주유소",
    brandCode: "SKE",
    energyType: "OIL",
    location: wgs84(37.5, 127.0),
    facilities: { carWash: false, maintenance: false, cvs: false },
    isKpetro: false,
    ...overrides,
  };
}

function request(query: string) {
  return new Request(`https://example.com/api/stations/nearby?${query}`);
}

describe("GET /api/stations/nearby — 요청 검증", () => {
  it("lat·lng·fuel이 없으면 400이다", async () => {
    const res = await GET(request(""));
    expect(res.status).toBe(400);
    expect(collectStationsMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/stations/nearby — 정상 흐름", () => {
  it("경로 의존 필드(tier·detour 등) 없이 { stations } 형태로 반환한다", async () => {
    collectStationsMock.mockResolvedValue({
      stations: [{ station: station(), price: 1700, pricedOn: "2026-09-04" }],
    });

    const res = await GET(request("lat=37.5&lng=127.0&fuel=GASOLINE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stations).toHaveLength(1);
    expect(body.stations[0]).not.toHaveProperty("tier");
    expect(body.stations[0]).not.toHaveProperty("detour");
    expect(body.stations[0]).not.toHaveProperty("netSaving");
    expect(body.stations[0].distanceM).toBe(0); // 검색 지점과 동일 좌표
  });

  it("시설·브랜드·품질인증·셀프 필터를 station-service에 전달한다", async () => {
    collectStationsMock.mockResolvedValue({ stations: [] });

    await GET(request(
      "lat=37.5&lng=127.0&fuel=GASOLINE&facilities=CAR_WASH,CVS&brands=SKE,RTX&kpetroOnly=true&selfOnly=true",
    ));

    expect(collectStationsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: {
        facilities: ["CAR_WASH", "CVS"],
        brands: ["SKE", "RTX"],
        kpetroOnly: true,
        selfOnly: true,
      },
    }));
  });

  it("sort=price(기본)면 가격순, sort=distance면 거리순으로 정렬한다", async () => {
    // SEARCH_RADIUS(3km) 이내로 잡아야 한다 — nearby route가 bbox 초과분을 원형
    // 반경으로 다시 걸러낸다 (bbox는 사각형이라 3km 밖 모서리가 섞일 수 있음).
    collectStationsMock.mockResolvedValue({
      stations: [
        { station: station({ id: "cheap-far", location: wgs84(37.515, 127.015) }), price: 1500, pricedOn: "2026-09-04" },
        { station: station({ id: "outside-radius", location: wgs84(37.53, 127.02) }), price: 1400, pricedOn: "2026-09-04" },
        { station: station({ id: "expensive-near", location: wgs84(37.5, 127.0) }), price: 1900, pricedOn: "2026-09-04" },
      ],
    });

    const byPrice = await GET(request("lat=37.5&lng=127.0&fuel=GASOLINE&sort=price"));
    const priceBody = await byPrice.json();
    expect(priceBody.stations.map((s: { id: string }) => s.id)).toEqual(["cheap-far", "expensive-near"]);

    const byDistance = await GET(request("lat=37.5&lng=127.0&fuel=GASOLINE&sort=distance"));
    const distanceBody = await byDistance.json();
    expect(distanceBody.stations.map((s: { id: string }) => s.id)).toEqual(["expensive-near", "cheap-far"]);
  });
});
