import { describe, expect, it } from "vitest";
import {
  classifyByDetour,
  isOutOfRange,
  detourSearchRadiusM,
} from "../tier";
import {
  T3_MAX,
  ON_ROUTE_MAX_S,
  ON_ROUTE_MAX_D,
} from "../params";

describe("classifyByDetour — 배지는 실측 ΔT·ΔD 둘 다로 판정한다 (불변식 6)", () => {
  it("ΔT·ΔD 둘 다 작으면 ON_ROUTE", () =>
    expect(classifyByDetour(0, 0)).toBe("ON_ROUTE"));
  it("경계값 두 개 다 딱 맞으면 ON_ROUTE", () =>
    expect(classifyByDetour(ON_ROUTE_MAX_S, ON_ROUTE_MAX_D)).toBe("ON_ROUTE"));

  it("ΔT가 크면 DETOUR — 경로 117m 옆인데 U턴 7분", () =>
    expect(classifyByDetour(7 * 60, 200)).toBe("DETOUR"));

  it("ΔD가 크면 DETOUR — 재라우팅으로 시간만 0인데 4.5km 더 돎", () =>
    expect(classifyByDetour(0, 4_500)).toBe("DETOUR"));

  it("ΔT 경계값+1 → DETOUR", () =>
    expect(classifyByDetour(ON_ROUTE_MAX_S + 1, 0)).toBe("DETOUR"));
  it("ΔD 경계값+1 → DETOUR", () =>
    expect(classifyByDetour(0, ON_ROUTE_MAX_D + 1)).toBe("DETOUR"));
});

describe("isOutOfRange", () => {
  it("T3_MAX 이하 → false", () => expect(isOutOfRange(T3_MAX)).toBe(false));
  it("T3_MAX 초과 → true", () => expect(isOutOfRange(T3_MAX + 0.001)).toBe(true));
});

describe("detourSearchRadiusM", () => {
  it("선택 거리보다 3km 넓게 검색한다", () => {
    expect(detourSearchRadiusM(3_000)).toBe(6_000);
    expect(detourSearchRadiusM(5_000)).toBe(8_000);
    expect(detourSearchRadiusM(10_000)).toBe(13_000);
  });

  it("15km를 넘지 않는다", () => {
    expect(detourSearchRadiusM(15_000)).toBe(15_000);
  });
});
