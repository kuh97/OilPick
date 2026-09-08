// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDetour, type FetchDetourInput } from "../useDetour";

const INPUT: FetchDetourInput = {
  origin: { lat: 37.42, lng: 127.12 },
  destination: { lat: 37.88, lng: 127.73 },
  stationId: "A0012345",
  vehicle: { efficiency: 8.5, refuelAmount: 45, timeValue: 200 },
  priceStation: 1650,
  referencePrice: 1210,
  avoidHighway: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDetour", () => {
  it("성공하면 DetourResult를 반환한다", async () => {
    const polyline = [{ lat: 37.5, lng: 127.3 }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ distanceM: 12400, durationS: 1080, precise: true, netSaving: 3252, polyline }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useDetour());
    let detour;
    await act(async () => {
      detour = await result.current.fetchDetour(INPUT);
    });

    expect(detour).toEqual({ distanceM: 12400, durationS: 1080, precise: true, netSaving: 3252, polyline });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("실패하면 null을 반환하고 error를 남긴다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "NOT_FOUND", message: "주유소를 찾을 수 없습니다." }), { status: 404 }),
      ),
    );

    const { result } = renderHook(() => useDetour());
    let detour;
    await act(async () => {
      detour = await result.current.fetchDetour(INPUT);
    });

    expect(detour).toBeNull();
    expect(result.current.error?.code).toBe("NOT_FOUND");
  });
});
