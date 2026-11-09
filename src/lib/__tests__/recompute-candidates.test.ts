import { describe, expect, it } from "vitest";
import {
  filterCandidates,
  recomputeCandidate,
  recomputeAndSort,
} from "../recompute-candidates";
import type { WireCandidate } from "@/app/api/_lib/types";

function candidate(overrides: Partial<WireCandidate> = {}): WireCandidate {
  return {
    id: "A1",
    name: "테스트주유소",
    brand: "SKE",
    lat: 37.5,
    lng: 127.0,
    address: "",
    tel: null,
    price: 1700,
    priceUpdatedAt: null,
    facilities: { carWash: false, maintenance: false, cvs: false },
    kpetro: false,
    tier: "ON_ROUTE",
    perpDistanceM: 100,
    detour: { precise: false, distanceM: 1000, durationS: 120 },
    netSaving: 999,
    estimatedCost: 99999,
    scores: { balanced: 1, minCost: 1, minDistance: 1 },
    reason: "원래 이유",
    ...overrides,
  };
}

describe("recomputeCandidate", () => {
  it("efficiency·refuelAmount가 바뀌면 estimatedCost·netSaving이 새 값으로 재계산된다", () => {
    const original = candidate();
    const cheaperCar = recomputeCandidate(original, { efficiency: 20, refuelAmount: 30, timeValue: 200 }, 1800);
    const thirstyCar = recomputeCandidate(original, { efficiency: 5, refuelAmount: 60, timeValue: 200 }, 1800);

    expect(cheaperCar.estimatedCost).not.toBe(thirstyCar.estimatedCost);
    expect(cheaperCar.netSaving).not.toBe(thirstyCar.netSaving);
  });

  it("reason 문구는 재생성하지 않고 그대로 유지한다", () => {
    const result = recomputeCandidate(candidate(), { efficiency: 20, refuelAmount: 30, timeValue: 200 }, 1800);
    expect(result.reason).toBe("원래 이유");
  });

  it("referencePrice가 null(A14)이면 netSaving을 건드리지 않는다", () => {
    const original = candidate({ netSaving: 777 });
    const result = recomputeCandidate(original, { efficiency: 10, refuelAmount: 45, timeValue: 200 }, null);
    expect(result.netSaving).toBe(777);
  });
});

describe("filterCandidates", () => {
  it("브랜드·시설·품질인증·셀프 조건으로 기존 목록만 걸러낸다", () => {
    const matching = candidate({
      id: "MATCH",
      brand: "SKE",
      kpetro: true,
      isSelf: true,
      facilities: { carWash: true, maintenance: true, cvs: true },
    });
    const notMatching = candidate({
      id: "NO_MATCH",
      brand: "GSC",
      kpetro: false,
      isSelf: false,
      facilities: { carWash: true, maintenance: false, cvs: true },
    });

    const result = filterCandidates([matching, notMatching], {
      facilities: ["CAR_WASH", "MAINTENANCE", "CVS"],
      brands: ["SKE"],
      kpetroOnly: true,
      selfOnly: true,
    });

    expect(result.map((c) => c.id)).toEqual(["MATCH"]);
  });

  it("필터를 모두 해제하면 서버가 준 목록을 그대로 보여준다", () => {
    const candidates = [candidate({ id: "A" }), candidate({ id: "B" })];

    expect(
      filterCandidates(candidates, {
        facilities: [],
        brands: [],
        kpetroOnly: false,
        selfOnly: false,
      }),
    ).toEqual(candidates);
  });

  it("셀프 여부를 모르는 후보는 셀프 필터에서 제외한다", () => {
    const result = filterCandidates(
      [candidate({ id: "UNKNOWN" }), candidate({ id: "SELF", isSelf: true })],
      { facilities: [], brands: [], kpetroOnly: false, selfOnly: true },
    );

    expect(result.map((c) => c.id)).toEqual(["SELF"]);
  });
});

describe("recomputeAndSort", () => {
  it("referencePrice가 있으면 balanced 모드 점수로 정렬한다", () => {
    const cheap = candidate({ id: "cheap", price: 1500, detour: { precise: true, distanceM: 0, durationS: 0 } });
    const farButCheaper = candidate({ id: "far", price: 1400, detour: { precise: true, distanceM: 20000, durationS: 1800 } });

    const sorted = recomputeAndSort([farButCheaper, cheap], { efficiency: 10, refuelAmount: 45, timeValue: 200 }, 1800, "minDistance");
    expect(sorted.map((c) => c.id)).toEqual(["cheap", "far"]); // minDistance 모드 — 우회 0인 쪽이 먼저
  });

  it("referencePrice가 null이면 가격순으로 정렬한다(모드 무관)", () => {
    const expensive = candidate({ id: "expensive", price: 2000 });
    const cheap = candidate({ id: "cheap", price: 1500 });

    const sorted = recomputeAndSort([expensive, cheap], { efficiency: 10, refuelAmount: 45, timeValue: 200 }, null, "balanced");
    expect(sorted.map((c) => c.id)).toEqual(["cheap", "expensive"]);
  });
});

// 서버(recommendation-service.finalizeCandidates)와 같은 규칙이어야 한다.
describe("recomputeAndSort — 전체 후보 모드 정렬", () => {
  const measuredButPricey = candidate({
    id: "MEASURED",
    price: 1800,
    detour: { precise: true, distanceM: 3000, durationS: 600 },
  });
  const estimatedAndCheap = candidate({
    id: "ESTIMATED",
    price: 1600,
    detour: { precise: false, distanceM: 0, durationS: 0 },
  });
  const vehicle = { efficiency: 12, refuelAmount: 45, timeValue: 200 };

  it("실측 여부보다 선택한 모드 점수를 먼저 적용한다", () => {
    const sorted = recomputeAndSort(
      [measuredButPricey, estimatedAndCheap],
      vehicle,
      1900,
      "minCost",
    );
    expect(sorted.map((c) => c.id)).toEqual(["ESTIMATED", "MEASURED"]);
  });

  it("referencePrice가 없으면 실측 여부와 무관하게 가격순이다", () => {
    const sorted = recomputeAndSort([estimatedAndCheap, measuredButPricey], vehicle, null, "balanced");
    expect(sorted.map((c) => c.id)).toEqual(["ESTIMATED", "MEASURED"]);
  });

  it("점수가 같을 때만 Kakao 확인 후보를 보조 기준으로 먼저 둔다", () => {
    const measured = candidate({
      id: "MEASURED_TIE",
      detour: { precise: true, distanceM: 0, durationS: 0 },
    });
    const estimated = candidate({
      id: "ESTIMATED_TIE",
      detour: { precise: false, distanceM: 0, durationS: 0 },
    });
    const sorted = recomputeAndSort([estimated, measured], vehicle, 1900, "minCost");
    expect(sorted.map((c) => c.id)).toEqual(["MEASURED_TIE", "ESTIMATED_TIE"]);
  });

  it("최소비용은 티어와 무관하게 더 싼 우회 후보를 먼저 보여준다", () => {
    const onRoute = candidate({
      id: "ON_ROUTE",
      price: 1900,
      tier: "ON_ROUTE",
      detour: { precise: true, distanceM: 0, durationS: 0 },
    });
    const cheapDetour = candidate({
      id: "CHEAP_DETOUR",
      price: 1500,
      tier: "DETOUR",
      detour: { precise: true, distanceM: 5000, durationS: 600 },
    });

    const sorted = recomputeAndSort([cheapDetour, onRoute], { efficiency: 10, refuelAmount: 45, timeValue: 200 }, 1900, "minCost");
    expect(sorted.map((c) => c.id)).toEqual(["CHEAP_DETOUR", "ON_ROUTE"]);
  });

  it("최단거리는 티어 강제가 없어도 우회량이 작은 경로상 후보가 먼저다", () => {
    const onRoute = candidate({
      id: "ON_ROUTE",
      tier: "ON_ROUTE",
      detour: { precise: false, distanceM: 0, durationS: 0 },
    });
    const detour = candidate({
      id: "DETOUR",
      tier: "DETOUR",
      detour: { precise: false, distanceM: 3000, durationS: 300 },
    });

    const sorted = recomputeAndSort([detour, onRoute], vehicle, 1900, "minDistance");
    expect(sorted.map((c) => c.id)).toEqual(["ON_ROUTE", "DETOUR"]);
  });
});

// 단대오거리역→모란역 실측(2026-09-08) — 1~14분대 근거리 후보 옆에 30~45분짜리가
// 그대로 섞여 나오던 문제. 서버 A6(SHORT_ROUTE_DETOUR_TIME_CAP_S)가 이미 최악을
// 거르지만, 그 안에서 "나는 몇 분까지만"은 사용자 취향 — 재요청 없이 필터링한다.
