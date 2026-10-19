// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminFeedbackCounts } from "../useAdminFeedbackCounts";

afterEach(() => vi.unstubAllGlobals());

describe("useAdminFeedbackCounts", () => {
  it("공용 query 캐시를 사용해 탭을 다시 렌더링해도 건수를 다시 조회하지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ counts: { ALL: 10, NEW: 3, IN_PROGRESS: 2, RESOLVED: 5 } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useAdminFeedbackCounts(), { wrapper });
    await waitFor(() => expect(first.result.current.counts?.ALL).toBe(10));

    const second = renderHook(() => useAdminFeedbackCounts(), { wrapper });
    await waitFor(() => expect(second.result.current.counts?.RESOLVED).toBe(5));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});
