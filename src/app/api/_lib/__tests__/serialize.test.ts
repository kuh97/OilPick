import { describe, expect, it } from "vitest";
import { serializeBaseRoute, serializeCandidate, serializeSearchResult } from "../serialize";
import { wgs84 } from "@/domain/types";
import type { BaseRoute, Candidate, SearchResult } from "@/domain/types";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    station: {
      id: "A0000001",
      name: "테스트주유소",
      brandCode: "SKE",
      energyType: "OIL",
      location: wgs84(37.5, 127.0),
      addressRoad: "성남대로 1",
      addressJibun: "정자동 1",
      tel: "031-000-0000",
      facilities: { carWash: true, maintenance: false, cvs: true },
      isKpetro: false,
    },
    price: 1700,
    dPerp: 320,
    tier: "T1",
    detour: { precise: false, distanceM: 640, durationS: 60 },
    netSaving: 1200,
    totalCost: 76500,
    scores: { minCost: 76500, minDistance: 640, balanced: 76700 },
    reason: "가장 저렴합니다",
    ...overrides,
  };
}

describe("serializeBaseRoute", () => {
  it("polyline의 브랜드 타입을 벗기고 lat/lng만 남긴다", () => {
    const route: BaseRoute = {
      distanceM: 1000,
      durationS: 60,
      polyline: [wgs84(37.1, 127.1), wgs84(37.2, 127.2)],
    };
    const wire = serializeBaseRoute(route);
    expect(wire).toEqual({
      distanceM: 1000,
      durationS: 60,
      polyline: [
        { lat: 37.1, lng: 127.1 },
        { lat: 37.2, lng: 127.2 },
      ],
    });
    expect(wire.polyline[0]).not.toHaveProperty("_brand");
  });

  it("tollWon(기본 경로 자체의 통행료)을 그대로 전달한다", () => {
    const route: BaseRoute = {
      distanceM: 1000,
      durationS: 60,
      tollWon: 1000,
      polyline: [wgs84(37.1, 127.1)],
    };
    expect(serializeBaseRoute(route).tollWon).toBe(1000);
  });
});

describe("serializeCandidate", () => {
  it("station 중첩 구조를 평탄화한다", () => {
    const wire = serializeCandidate(candidate());
    expect(wire.id).toBe("A0000001");
    expect(wire.name).toBe("테스트주유소");
    expect(wire.brand).toBe("SKE");
    expect(wire.lat).toBe(37.5);
    expect(wire.lng).toBe(127.0);
  });

  it("도로명 주소가 있으면 도로명을 쓰고, 없으면 지번으로 폴백한다", () => {
    const withRoad = serializeCandidate(candidate());
    expect(withRoad.address).toBe("성남대로 1");

    const withoutRoad = serializeCandidate(
      candidate({
        station: {
          ...candidate().station,
          addressRoad: undefined,
          addressJibun: "정자동 1",
        },
      }),
    );
    expect(withoutRoad.address).toBe("정자동 1");
  });

  it("dPerp → perpDistanceM, totalCost → estimatedCost로 이름을 바꾼다", () => {
    const wire = serializeCandidate(candidate());
    expect(wire.perpDistanceM).toBe(320);
    expect(wire.estimatedCost).toBe(76500);
  });

  it("detour.tollWon(정보 표시 전용)을 그대로 전달한다", () => {
    const wire = serializeCandidate(candidate({ detour: { precise: true, distanceM: 1000, durationS: 90, tollWon: 2900 } }));
    expect(wire.detour.tollWon).toBe(2900);
  });

  it("priceUpdatedAt이 없으면 null, 있으면 ISO 문자열이다", () => {
    expect(serializeCandidate(candidate()).priceUpdatedAt).toBeNull();

    const date = new Date("2026-08-31T00:00:00.000Z");
    const wire = serializeCandidate(candidate({ priceUpdatedAt: date }));
    expect(wire.priceUpdatedAt).toBe(date.toISOString());
  });

  it("tel이 없으면 null이다", () => {
    const wire = serializeCandidate(candidate({ station: { ...candidate().station, tel: undefined } }));
    expect(wire.tel).toBeNull();
  });
});

describe("serializeSearchResult", () => {
  it("candidates를 매핑하고 나머지 필드는 그대로 전달한다", () => {
    const result: SearchResult = {
      searchId: "s-1",
      baseRoute: { distanceM: 1000, durationS: 60, polyline: [wgs84(37.1, 127.1)] },
      candidates: [candidate()],
      referencePrice: 1800,
      refPriceSource: "MEDIAN_T1T2",
      expansion: { triggered: false, finalRadiusM: 3000 },
      warnings: [{ code: "SHORT_ROUTE", message: "경로가 짧습니다" }],
    };

    const wire = serializeSearchResult(result);
    expect(wire.searchId).toBe("s-1");
    expect(wire.referencePrice).toBe(1800);
    expect(wire.refPriceSource).toBe("MEDIAN_T1T2");
    expect(wire.expansion).toEqual({ triggered: false, finalRadiusM: 3000 });
    expect(wire.warnings).toEqual([{ code: "SHORT_ROUTE", message: "경로가 짧습니다" }]);
    expect(wire.candidates).toHaveLength(1);
    expect(wire.candidates[0].id).toBe("A0000001");
  });
});
