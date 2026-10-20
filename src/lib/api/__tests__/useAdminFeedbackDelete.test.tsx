// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminFeedbackDelete } from "../useAdminFeedbackDelete";

afterEach(() => vi.unstubAllGlobals());

describe("useAdminFeedbackDelete", () => {
  it("문의 삭제 후 목록과 상태별 건수를 다시 조회하도록 캐시를 무효화한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(["admin-feedback", "ALL"], { pages: [], pageParams: [] });
    queryClient.setQueryData(["admin-feedback-counts"], {
      ALL: 1,
      NEW: 1,
      IN_PROGRESS: 0,
      RESOLVED: 0,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAdminFeedbackDelete(), { wrapper });

    act(() => result.current.deleteFeedback({ id: "feedback-1" }));
    await waitFor(() => expect(result.current.isDeleting).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/feedback/feedback-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(queryClient.getQueryState(["admin-feedback", "ALL"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["admin-feedback-counts"])?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
