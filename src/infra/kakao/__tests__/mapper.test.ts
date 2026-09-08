import { describe, expect, it } from "vitest";
import { mapDirectionsRoute, mapPlaceDocument } from "../mapper";
import { KakaoDirectionsResponseSchema, KakaoLocalSearchResponseSchema } from "../schema";
import directionsFixture from "../../../../tests/fixtures/kakao-directions.json";
import localFixture from "../../../../tests/fixtures/kakao-local.json";

describe("mapDirectionsRoute", () => {
  const route = KakaoDirectionsResponseSchema.parse(directionsFixture).routes[0];

  it("summary의 distance·duration을 그대로 옮긴다", () => {
    const baseRoute = mapDirectionsRoute(route);
    expect(baseRoute.distanceM).toBe(route.summary.distance);
    expect(baseRoute.durationS).toBe(route.summary.duration);
  });

  it("모든 section·road의 vertexes를 이어붙여 폴리라인을 만든다", () => {
    const baseRoute = mapDirectionsRoute(route);
    const totalVertexPairs = route.sections.reduce(
      (sum, s) => sum + s.roads.reduce((rs, r) => rs + r.vertexes.length / 2, 0),
      0,
    );
    expect(baseRoute.polyline.length).toBe(totalVertexPairs);
  });

  it("★ vertexes는 [lng, lat] 순서 — 뒤집지 않고 lat/lng에 매핑한다", () => {
    const baseRoute = mapDirectionsRoute(route);
    const [lng, lat] = route.sections[0].roads[0].vertexes;
    expect(baseRoute.polyline[0].lng).toBe(lng);
    expect(baseRoute.polyline[0].lat).toBe(lat);
  });

  it("폴리라인 좌표가 WGS84 브랜드 타입이다", () => {
    const baseRoute = mapDirectionsRoute(route);
    expect(baseRoute.polyline[0]._brand).toBe("WGS84");
  });

  it("sections가 비어있으면 빈 폴리라인을 반환한다", () => {
    const empty = mapDirectionsRoute({ ...route, sections: [] });
    expect(empty.polyline).toEqual([]);
  });

  it("summary.fare.toll을 tollWon으로 옮긴다", () => {
    const baseRoute = mapDirectionsRoute(route);
    expect(baseRoute.tollWon).toBe(route.summary.fare?.toll);
  });

  it("fare가 없으면 tollWon은 0으로 기본값을 둔다", () => {
    const withoutFare = { ...route, summary: { ...route.summary, fare: undefined } };
    const baseRoute = mapDirectionsRoute(withoutFare);
    expect(baseRoute.tollWon).toBe(0);
  });
});

describe("mapPlaceDocument", () => {
  const docs = KakaoLocalSearchResponseSchema.parse(localFixture).documents;

  it("place_name → name, 도로명주소 우선 → address", () => {
    const place = mapPlaceDocument(docs[0]);
    expect(place.name).toBe(docs[0].place_name);
    expect(place.address).toBe(docs[0].road_address_name || docs[0].address_name);
  });

  it("도로명주소가 없으면 지번주소를 쓴다", () => {
    const place = mapPlaceDocument({ ...docs[0], road_address_name: undefined });
    expect(place.address).toBe(docs[0].address_name);
  });

  it("문자열 x·y를 숫자로 변환해 WGS84Point를 만든다", () => {
    const place = mapPlaceDocument(docs[0]);
    expect(place.location.lat).toBe(Number(docs[0].y));
    expect(place.location.lng).toBe(Number(docs[0].x));
    expect(place.location._brand).toBe("WGS84");
  });
});
