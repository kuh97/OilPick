import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw/server";
import valhallaFixture from "../../../../tests/fixtures/valhalla-route.json";
import { wgs84 } from "@/domain/types";
import { fetchValhallaRoute, mapMatchValhallaRoute } from "../client";
import { decodePolyline6 } from "../mapper";

const VALHALLA_BASE_URL = "http://127.0.0.1:8002";
const ORIGIN = wgs84(37, 127);
const DESTINATION = wgs84(37.001, 127.0005);

describe("Valhalla mapper", () => {
  it("6자리 encoded polyline을 WGS84로 디코딩한다", () => {
    const points = decodePolyline6(valhallaFixture.trip.legs[0].shape);
    expect(points).toEqual([
      wgs84(37, 127),
      wgs84(37.0001, 127.0001),
      wgs84(37.001, 127.0005),
    ]);
  });
});

describe("fetchValhallaRoute", () => {
  it("출발지·목적지·경유지를 route 요청으로 보내고 m·s로 변환한다", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${VALHALLA_BASE_URL}/route`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(valhallaFixture);
      }),
    );

    const route = await fetchValhallaRoute({
      origin: ORIGIN,
      waypoint: wgs84(37.0001, 127.0001),
      destination: DESTINATION,
      baseUrl: VALHALLA_BASE_URL,
      timeoutMs: 1_000,
    });

    expect(body).toMatchObject({ costing: "auto", units: "kilometers" });
    expect((body?.locations as unknown[]).length).toBe(3);
    expect(route.distanceM).toBe(123);
    expect(route.durationS).toBe(43);
    expect(route.polyline).toHaveLength(3);
  });

  it("잘못된 응답은 파싱 실패로 처리한다", async () => {
    server.use(
      http.post(`${VALHALLA_BASE_URL}/route`, () => HttpResponse.json({ wrong: true })),
    );
    await expect(
      fetchValhallaRoute({
        origin: ORIGIN,
        destination: DESTINATION,
        baseUrl: VALHALLA_BASE_URL,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/Valhalla 응답 파싱 실패/);
  });
});

describe("mapMatchValhallaRoute", () => {
  it("trace_route에 첫·마지막 break와 중간 via를 보낸다", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${VALHALLA_BASE_URL}/trace_route`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(valhallaFixture);
      }),
    );

    await mapMatchValhallaRoute({
      polyline: [ORIGIN, wgs84(37.0001, 127.0001), DESTINATION],
      baseUrl: VALHALLA_BASE_URL,
      timeoutMs: 1_000,
    });

    expect(body).toMatchObject({ costing: "auto", shape_match: "map_snap" });
    expect(body?.shape).toEqual([
      { lat: 37, lon: 127, type: "break" },
      { lat: 37.0001, lon: 127.0001, type: "via" },
      { lat: 37.001, lon: 127.0005, type: "break" },
    ]);
  });

  it("폴리라인이 1점이면 요청하지 않는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      mapMatchValhallaRoute({
        polyline: [ORIGIN],
        baseUrl: VALHALLA_BASE_URL,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/두 개 이상의/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("Valhalla timeout", () => {
  it("timeout을 명확한 오류로 구분한다", async () => {
    server.use(
      http.post(`${VALHALLA_BASE_URL}/route`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(valhallaFixture);
      }),
    );

    await expect(
      fetchValhallaRoute({
        origin: ORIGIN,
        destination: DESTINATION,
        baseUrl: VALHALLA_BASE_URL,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ name: "ValhallaTimeoutError" });
  });
});
