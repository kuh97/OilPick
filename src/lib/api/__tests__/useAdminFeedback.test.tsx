// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminFeedback, type AdminFeedbackStatusFilter } from "../useAdminFeedback";

function feedback(id: string, status: "NEW" | "IN_PROGRESS" | "RESOLVED") {
  return {
    id,
    email: "user@example.com",
    subject: "문의 제목",
    content: "문의 내용",
    feedbackSource: null,
    stationId: null,
    stationName: null,
    searchId: null,
    originName: null,
    destinationName: null,
    status,
    createdAt: "2026-10-19T01:02:03.000Z",
    resolvedAt: null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useAdminFeedback", () => {
  it("다음 페이지를 불러오고 탭을 돌아오면 기존 탭 캐시를 재사용한다", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=all-next")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            items: [feedback("all-2", "NEW")],
            nextCursor: null,
          })),
        );
      }
      if (url.includes("status=NEW")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            items: [feedback("new-1", "NEW")],
            nextCursor: null,
          })),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({
          items: [feedback("all-1", "NEW")],
          nextCursor: "all-next",
        })),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    type Props = { status: AdminFeedbackStatusFilter };
    const { result, rerender } = renderHook(({ status }: Props) => useAdminFeedback(status), {
      initialProps: { status: "ALL" },
      wrapper,
    });

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["all-1"]));
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["all-1", "all-2"]));

    rerender({ status: "NEW" });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["new-1"]));

    rerender({ status: "ALL" });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["all-1", "all-2"]));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    queryClient.clear();
  });
});
