// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useNearbyStations } from "../useNearbyStations";

const POINT = { lat: 37.5, lng: 127.0 };

afterEach(() => vi.unstubAllGlobals());

describe("useNearbyStations", () => {
  it("위치가 없으면 요청하지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNearbyStations(null, "GASOLINE"));
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.stations).toEqual([]);
  });

  it("위치·연료를 API에 전달하고 주변 목록을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      stations: [{ id: "A1", name: "주변 주유소", price: 1700, distanceM: 800 }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNearbyStations(POINT, "DIESEL"));
    await waitFor(() => expect(result.current.stations).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stations/nearby?lat=37.5&lng=127&fuel=DIESEL",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.stations[0].id).toBe("A1");
  });

  it("API 실패 시 오류를 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    const { result } = renderHook(() => useNearbyStations(POINT, "GASOLINE"));
    await waitFor(() => expect(result.current.error?.message).toBe("주변 주유소를 찾지 못했습니다."));

    expect(result.current.error?.message).toBe("주변 주유소를 찾지 못했습니다.");
  });

  it("연료가 바뀌면 이전 연료 목록을 지우고 새 요청을 기다린다", async () => {
    type NearbyProps = { fuel: "GASOLINE" | "DIESEL" };
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ stations: [{ id: "GAS" }] }), { status: 200 }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ fuel }: NearbyProps) => useNearbyStations(POINT, fuel),
      { initialProps: { fuel: "GASOLINE" } as NearbyProps },
    );
    await waitFor(() => expect(result.current.stations).toHaveLength(1));

    rerender({ fuel: "DIESEL" });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
      expect(result.current.stations).toEqual([]);
    });

    await act(async () => {
      resolveSecond?.(new Response(JSON.stringify({ stations: [{ id: "DIESEL" }] }), { status: 200 }));
    });
    await waitFor(() => expect(result.current.stations[0]?.id).toBe("DIESEL"));
  });
});
