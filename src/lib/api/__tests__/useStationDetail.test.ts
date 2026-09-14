// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useStationDetail } from "../useStationDetail";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStationDetail", () => {
  it("stationId가 null이면 아무것도 하지 않는다", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useStationDetail(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("성공하면 station을 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "A1", name: "테스트주유소", price: 1650 }), { status: 200 }),
      ),
    );

    const { result } = renderHook(() => useStationDetail("A1"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.station?.id).toBe("A1");
    expect(result.current.error).toBeNull();
  });

  it("404면 error를 반환하고 station은 null이다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "NOT_FOUND", message: "주유소를 찾을 수 없습니다." }), { status: 404 }),
      ),
    );

    const { result } = renderHook(() => useStationDetail("none"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.station).toBeNull();
    expect(result.current.error?.code).toBe("NOT_FOUND");
  });
});
