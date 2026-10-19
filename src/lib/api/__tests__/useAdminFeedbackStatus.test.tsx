// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminFeedbackStatus } from "../useAdminFeedbackStatus";

afterEach(() => vi.unstubAllGlobals());

describe("useAdminFeedbackStatus", () => {
  it("상태 변경 후 문의 목록과 탭별 건수를 다시 조회하도록 캐시를 무효화한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          item: {
            id: "feedback-1",
            email: "user@example.com",
            subject: "문의 제목",
            content: "문의 내용",
            stationId: null,
            searchId: null,
            status: "RESOLVED",
            createdAt: "2026-10-19T01:02:03.000Z",
            resolvedAt: "2026-10-19T03:04:05.000Z",
          },
        }),
      ),
    );
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
    const { result } = renderHook(() => useAdminFeedbackStatus(), { wrapper });

    act(() => result.current.updateStatus({ id: "feedback-1", status: "RESOLVED" }));
    await waitFor(() => expect(result.current.isUpdating).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/feedback/feedback-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(queryClient.getQueryState(["admin-feedback", "ALL"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["admin-feedback-counts"])?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
