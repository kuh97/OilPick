import { describe, expect, it } from "vitest";
import { routeKey, placeKey, gridSnapWgs84 } from "../keys";
import { wgs84 } from "@/domain/types";

describe("routeKey", () => {
  it("경유지 없는 기본 경로", () => {
    const key = routeKey("dev", "37.5_127.0", "35.1_129.0");
    expect(key).toBe("dev:route:37.5_127.0:35.1_129.0");
  });

  it("경유지 포함 경로", () => {
    const key = routeKey("dev", "37.5_127.0", "35.1_129.0", "36.3_128.0");
    expect(key).toBe("dev:route:37.5_127.0:35.1_129.0:36.3_128.0");
  });

  it("경유지 유무에 따라 다른 키", () => {
    const k1 = routeKey("dev", "A", "B");
    const k2 = routeKey("dev", "A", "B", "C");
    expect(k1).not.toBe(k2);
  });

  // avoidHighway를 켜고 끈 결과는 완전히 다른 경로다 — 키가 같으면 회피를 켠 사용자가
  // 끈 사용자의(또는 그 반대) 캐시된 경로를 그대로 받는다.
  it("avoidHighway 유무에 따라 다른 키 (기본 경로)", () => {
    const withAvoid = routeKey("dev", "A", "B", undefined, true);
    const withoutAvoid = routeKey("dev", "A", "B", undefined, false);
    expect(withAvoid).not.toBe(withoutAvoid);
  });

  it("avoidHighway 유무에 따라 다른 키 (경유 경로)", () => {
    const withAvoid = routeKey("dev", "A", "B", "C", true);
    const withoutAvoid = routeKey("dev", "A", "B", "C", false);
    expect(withAvoid).not.toBe(withoutAvoid);
  });

  it("avoidHighway를 생략하면 false와 같은 키다 (하위 호환)", () => {
    expect(routeKey("dev", "A", "B")).toBe(routeKey("dev", "A", "B", undefined, false));
  });
});

describe("gridSnapWgs84 — 2km 격자 스냅 (route/placeKey, Phase 11 이벤트 로깅 공용)", () => {
  it("\"x_y\" 형식 문자열을 반환한다", () => {
    const key = gridSnapWgs84(wgs84(37.5, 127.0));
    expect(key).toMatch(/^-?\d+_-?\d+$/);
  });

  it("아주 가까운 두 좌표는 같은 격자로 스냅된다", () => {
    const a = gridSnapWgs84(wgs84(37.5, 127.0));
    const b = gridSnapWgs84(wgs84(37.50001, 127.00001));
    expect(a).toBe(b);
  });

  it("충분히 떨어진 두 좌표는 다른 격자로 스냅된다", () => {
    const a = gridSnapWgs84(wgs84(37.5, 127.0));
    const b = gridSnapWgs84(wgs84(37.6, 127.1));
    expect(a).not.toBe(b);
  });

  it("routeKey에 바로 넣을 수 있다", () => {
    const origin = gridSnapWgs84(wgs84(37.42, 127.12));
    const dest = gridSnapWgs84(wgs84(37.88, 127.73));
    const key = routeKey("dev", origin, dest);
    expect(key.startsWith("dev:route:")).toBe(true);
  });
});

describe("placeKey", () => {
  it("{prefix}:place:{encoded} 형식", () => {
    const key = placeKey("dev", "강남역");
    expect(key.startsWith("dev:place:")).toBe(true);
  });

  it("쿼리가 다르면 다른 키", () => {
    expect(placeKey("dev", "강남역")).not.toBe(placeKey("dev", "서울역"));
  });
});
