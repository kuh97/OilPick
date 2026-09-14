// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useStationRoute } from "../useStationRoute";

const ORIGIN = { lat: 37.42, lng: 127.12 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStationRoute", () => {
  it("stationId 또는 origin이 없으면 요청하지 않는다", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useStationRoute(null, null));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("성공하면 실제 도로 경로를 반환한다", async () => {
    const route = {
      distanceM: 3200,
      durationS: 480,
      polyline: [ORIGIN, { lat: 37.6, lng: 127.4 }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(route), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStationRoute("A1", ORIGIN));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stations/directions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ stationId: "A1", origin: ORIGIN }),
      }),
    );
    expect(result.current.route).toEqual(route);
    expect(result.current.error).toBeNull();
  });

  it("실패하면 오류를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "ROUTE_FETCH_FAILED", message: "경로 실패" }), { status: 502 }),
      ),
    );

    const { result } = renderHook(() => useStationRoute("A1", ORIGIN));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.route).toBeNull();
    expect(result.current.error).toEqual({ code: "ROUTE_FETCH_FAILED", message: "경로 실패" });
  });
});
