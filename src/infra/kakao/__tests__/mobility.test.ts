import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw/server";
import { fetchDirections } from "../mobility";
import { wgs84 } from "@/domain/types";
import directionsFixture from "../../../../tests/fixtures/kakao-directions.json";
import directionsWaypointFixture from "../../../../tests/fixtures/kakao-directions-waypoint.json";

vi.stubEnv("KAKAO_REST_API_KEY", "test-rest-key");
vi.stubEnv("KAKAO_MOBILITY_BASE_URL", "https://apis-navi.kakaomobility.com");

const KAKAO_MOBILITY_URL = "https://apis-navi.kakaomobility.com/v1/directions";
const ORIGIN = wgs84(37.4201, 127.1268);
const DESTINATION = wgs84(37.8813, 127.7298);

describe("fetchDirections — 경유지 없음 (기본 경로)", () => {
  it("MSW 픽스처 응답을 BaseRoute로 매핑한다", async () => {
    const route = await fetchDirections({ origin: ORIGIN, destination: DESTINATION });
    const expected = directionsFixture.routes[0].summary;
    expect(route.distanceM).toBe(expected.distance);
    expect(route.durationS).toBe(expected.duration);
    expect(route.polyline.length).toBeGreaterThan(0);
  });

  it("요청 URL에 waypoints 파라미터가 붙지 않는다", async () => {
    let capturedUrl = "";
    server.use(
      http.get(KAKAO_MOBILITY_URL, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(directionsFixture);
      }),
    );
    await fetchDirections({ origin: ORIGIN, destination: DESTINATION });
    expect(new URL(capturedUrl).searchParams.has("waypoints")).toBe(false);
  });

  it("avoidHighway: true면 avoid=motorway를 붙인다", async () => {
    let capturedUrl = "";
    server.use(
      http.get(KAKAO_MOBILITY_URL, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(directionsFixture);
      }),
    );
    await fetchDirections({ origin: ORIGIN, destination: DESTINATION, avoidHighway: true });
    expect(new URL(capturedUrl).searchParams.get("avoid")).toBe("motorway");
  });

  it("avoidHighway를 생략하거나 false면 avoid 파라미터가 없다", async () => {
    let capturedUrl = "";
    server.use(
      http.get(KAKAO_MOBILITY_URL, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(directionsFixture);
      }),
    );
    await fetchDirections({ origin: ORIGIN, destination: DESTINATION, avoidHighway: false });
    expect(new URL(capturedUrl).searchParams.has("avoid")).toBe(false);
  });
});

describe("fetchDirections — 경유지 1개 (경유 경로)", () => {
  const waypoint = wgs84(37.8228, 127.7183);

  it("waypoints 파라미터가 붙고 경유 경로 픽스처를 매핑한다", async () => {
    const route = await fetchDirections({
      origin: ORIGIN,
      destination: DESTINATION,
      waypoint,
      retries: 0,
    });
    const expected = directionsWaypointFixture.routes[0].summary;
    expect(route.distanceM).toBe(expected.distance);
    expect(route.durationS).toBe(expected.duration);
  });

  it("retries: 0을 넘기면 실패 시 재시도하지 않는다", async () => {
    let callCount = 0;
    server.use(
      http.get(KAKAO_MOBILITY_URL, () => {
        callCount++;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(
      fetchDirections({ origin: ORIGIN, destination: DESTINATION, waypoint, retries: 0 }),
    ).rejects.toThrow();
    expect(callCount).toBe(1);
  });
});

describe("오류 처리", () => {
  it("result_code !== 0 (경로 없음) → 에러 throw", async () => {
    server.use(
      http.get(KAKAO_MOBILITY_URL, () =>
        HttpResponse.json({
          trans_id: "t",
          routes: [
            {
              result_code: 104,
              result_msg: "경로 탐색에 실패했습니다",
              summary: {
                origin: { name: "", x: 0, y: 0 },
                destination: { name: "", x: 0, y: 0 },
                waypoints: [],
                distance: 0,
                duration: 0,
              },
              sections: [],
            },
          ],
        }),
      ),
    );
    await expect(
      fetchDirections({ origin: ORIGIN, destination: DESTINATION, retries: 0 }),
    ).rejects.toThrow(/경로 탐색에 실패했습니다/);
  });

  it("HTTP 오류 → 재시도 후 에러 throw", async () => {
    server.use(http.get(KAKAO_MOBILITY_URL, () => new HttpResponse(null, { status: 500 })));
    await expect(
      fetchDirections({ origin: ORIGIN, destination: DESTINATION, retries: 0 }),
    ).rejects.toThrow();
  });

  it("잘못된 응답 형태 → 파싱 에러 throw", async () => {
    server.use(http.get(KAKAO_MOBILITY_URL, () => HttpResponse.json({ wrong: true })));
    await expect(
      fetchDirections({ origin: ORIGIN, destination: DESTINATION, retries: 0 }),
    ).rejects.toThrow(/파싱 실패/);
  });
});
