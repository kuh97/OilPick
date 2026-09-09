import { describe, expect, it } from "vitest";
import { recomputeCandidate, recomputeAndSort } from "../recompute-candidates";
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

// 서버(recommendation-service.finalizeCandidates)와 같은 규칙이어야 한다 —
// 여기서만 빠뜨리면 모드 탭을 누르는 순간 추정치가 다시 실측치를 이긴다.
describe("recomputeAndSort — 실측군 우선 (AGENTS.md §5 불변식 4)", () => {
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

  it("점수가 나빠도 실측 후보가 추정 후보보다 위에 온다", () => {
    for (const mode of ["balanced", "minCost", "minDistance"] as const) {
      const sorted = recomputeAndSort([estimatedAndCheap, measuredButPricey], vehicle, 1900, mode);
      expect(sorted.map((c) => c.id)).toEqual(["MEASURED", "ESTIMATED"]);
    }
  });

  it("referencePrice가 없어(A14) 가격순으로 갈 때도 실측군이 먼저다", () => {
    const sorted = recomputeAndSort([estimatedAndCheap, measuredButPricey], vehicle, null, "balanced");
    expect(sorted.map((c) => c.id)).toEqual(["MEASURED", "ESTIMATED"]);
  });

  it("같은 군 안에서는 모드 점수 순으로 정렬한다", () => {
    const cheap = candidate({ id: "CHEAP", price: 1600, detour: { precise: true, distanceM: 0, durationS: 0 } });
    const pricey = candidate({ id: "PRICEY", price: 1800, detour: { precise: true, distanceM: 0, durationS: 0 } });
    const sorted = recomputeAndSort([pricey, cheap], vehicle, 1900, "minCost");
    expect(sorted.map((c) => c.id)).toEqual(["CHEAP", "PRICEY"]);
  });
});

// 단대오거리역→모란역 실측(2026-09-08) — 1~14분대 근거리 후보 옆에 30~45분짜리가
// 그대로 섞여 나오던 문제. 서버 A6(SHORT_ROUTE_DETOUR_TIME_CAP_S)가 이미 최악을
// 거르지만, 그 안에서 "나는 몇 분까지만"은 사용자 취향 — 재요청 없이 필터링한다.
