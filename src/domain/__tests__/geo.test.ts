import { describe, expect, it } from "vitest";
import {
  katecToWgs84,
  wgs84ToKatec,
  wgs84ToProjected,
  projectedToWgs84,
  pointToSegmentDistanceM,
  pointToPolylineDistanceM,
  distanceM,
} from "../geo";
import { wgs84, katec, projected } from "../types";

// verify:coord 실측값 (서울 강남 lat=37.4945, lng=127.0345)
const GANGNAM_WGS84 = wgs84(37.4945, 127.0345);
const GANGNAM_KATEC = katec(314_820, 544_030);

describe("좌표 변환", () => {
  it("KATEC → WGS84 왕복 오차 50m 이내", () => {
    const w = katecToWgs84(GANGNAM_KATEC);
    const back = wgs84ToKatec(w);

    const orig = wgs84ToProjected(GANGNAM_WGS84);
    const roundtrip = wgs84ToProjected(w);
    const error = distanceM(orig, roundtrip);

    expect(error).toBeLessThan(50);
    expect(w.lat).toBeCloseTo(37.4945, 2);
    expect(w.lng).toBeCloseTo(127.0345, 2);
    expect(back.x).toBeCloseTo(GANGNAM_KATEC.x, -1); // 10m 이내
    expect(back.y).toBeCloseTo(GANGNAM_KATEC.y, -1);
  });

  it("WGS84 → Projected → WGS84 왕복 오차 1m 이내", () => {
    const p = wgs84ToProjected(GANGNAM_WGS84);
    const back = projectedToWgs84(p);
    const orig = wgs84ToProjected(GANGNAM_WGS84);
    const roundtrip = wgs84ToProjected(back);
    expect(distanceM(orig, roundtrip)).toBeLessThan(1);
  });
});

describe("pointToSegmentDistanceM — 선분 기준 최단거리", () => {
  // 단위 정사각형 (0,0)-(10,0)-(10,10)-(0,10)
  const a = projected(0, 0);
  const b = projected(10, 0);

  it("선분 위의 수선 발이 존재하는 경우 — 꼭짓점이 아닌 선분 기준", () => {
    const p = projected(5, 3);
    expect(pointToSegmentDistanceM(p, a, b)).toBeCloseTo(3, 5);
  });

  it("꼭짓점 A 쪽으로 클램프", () => {
    const p = projected(-3, 4);
    expect(pointToSegmentDistanceM(p, a, b)).toBeCloseTo(5, 5);
  });

  it("꼭짓점 B 쪽으로 클램프", () => {
    const p = projected(13, 4);
    expect(pointToSegmentDistanceM(p, a, b)).toBeCloseTo(5, 5);
  });

  it("점이 선분 위에 있으면 0", () => {
    expect(pointToSegmentDistanceM(projected(5, 0), a, b)).toBeCloseTo(0, 5);
  });

  it("선분이 점으로 퇴화한 경우", () => {
    expect(pointToSegmentDistanceM(projected(3, 4), a, a)).toBeCloseTo(5, 5);
  });

  it("꼭짓점 기준 거리와 다른 결과를 내는 케이스 (선분 기준 검증 핵심)", () => {
    // p=(5,3) → 선분AB까지 = 3m (수선)
    // p→A 거리 = √(25+9)=5.83, p→B 거리 = √(25+9)=5.83
    // 선분 기준이 꼭짓점 기준보다 짧아야 함
    const p = projected(5, 3);
    const segDist = pointToSegmentDistanceM(p, a, b);
    const vertexDist = Math.min(distanceM(p, a), distanceM(p, b));
    expect(segDist).toBeLessThan(vertexDist);
  });
});

describe("pointToPolylineDistanceM", () => {
  const line = [projected(0, 0), projected(10, 0), projected(10, 10)];

  it("각 선분의 최솟값을 반환한다", () => {
    const p = projected(5, 3);
    const d = pointToPolylineDistanceM(p, line);
    expect(d).toBeCloseTo(3, 5);
  });

  it("빈 폴리라인 → Infinity", () => {
    expect(pointToPolylineDistanceM(projected(0, 0), [])).toBe(Infinity);
  });
});
