import { describe, expect, it } from "vitest";
import { KakaoDirectionsResponseSchema, KakaoLocalSearchResponseSchema } from "../schema";
import directionsFixture from "../../../../tests/fixtures/kakao-directions.json";
import directionsWaypointFixture from "../../../../tests/fixtures/kakao-directions-waypoint.json";
import localFixture from "../../../../tests/fixtures/kakao-local.json";

describe("KakaoDirectionsResponseSchema — 픽스처 파싱", () => {
  it("경유지 없는 길찾기 픽스처가 스키마를 통과한다", () => {
    const result = KakaoDirectionsResponseSchema.safeParse(directionsFixture);
    expect(result.success).toBe(true);
  });

  it("경유지 포함 길찾기 픽스처가 스키마를 통과한다", () => {
    const result = KakaoDirectionsResponseSchema.safeParse(directionsWaypointFixture);
    expect(result.success).toBe(true);
  });

  it("route.summary가 distance·duration을 정수로 갖는다", () => {
    const result = KakaoDirectionsResponseSchema.parse(directionsFixture);
    const summary = result.routes[0].summary;
    expect(typeof summary.distance).toBe("number");
    expect(typeof summary.duration).toBe("number");
  });

  it("경유지 포함 응답은 summary.waypoints가 비어있지 않다", () => {
    const result = KakaoDirectionsResponseSchema.parse(directionsWaypointFixture);
    expect(result.routes[0].summary.waypoints.length).toBeGreaterThan(0);
  });

  it("경유지 없는 응답은 summary.waypoints가 비어있다", () => {
    const result = KakaoDirectionsResponseSchema.parse(directionsFixture);
    expect(result.routes[0].summary.waypoints.length).toBe(0);
  });

  it("routes가 없으면 파싱 실패", () => {
    expect(KakaoDirectionsResponseSchema.safeParse({ trans_id: "x" }).success).toBe(false);
  });

  it("summary.fare(taxi·toll)를 파싱한다 — 픽스처엔 통행료가 있다", () => {
    const result = KakaoDirectionsResponseSchema.parse(directionsFixture);
    expect(result.routes[0].summary.fare).toEqual({ taxi: 95500, toll: 5900 });
  });

  it("summary.fare가 없어도 파싱에 실패하지 않는다 (optional)", () => {
    const withoutFare = {
      ...directionsFixture,
      routes: [
        {
          ...directionsFixture.routes[0],
          summary: { ...directionsFixture.routes[0].summary, fare: undefined },
        },
      ],
    };
    const result = KakaoDirectionsResponseSchema.safeParse(withoutFare);
    expect(result.success).toBe(true);
  });
});

describe("KakaoLocalSearchResponseSchema — 픽스처 파싱", () => {
  it("로컬 검색 픽스처가 스키마를 통과한다", () => {
    const result = KakaoLocalSearchResponseSchema.safeParse(localFixture);
    expect(result.success).toBe(true);
  });

  it("각 문서가 x·y를 문자열로 갖는다 (길찾기 API와 다름)", () => {
    const result = KakaoLocalSearchResponseSchema.parse(localFixture);
    for (const doc of result.documents) {
      expect(typeof doc.x).toBe("string");
      expect(typeof doc.y).toBe("string");
    }
  });

  it("documents 없으면 파싱 실패", () => {
    expect(KakaoLocalSearchResponseSchema.safeParse({ meta: {} }).success).toBe(false);
  });
});
