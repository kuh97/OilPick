"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";

export type AdminFeedbackStatus = "NEW" | "IN_PROGRESS" | "RESOLVED";
export type AdminFeedbackStatusFilter = AdminFeedbackStatus | "ALL";
export type AdminFeedbackSource = "HOME" | "NEARBY" | "NEARBY_DETAIL" | "SEARCH" | "SEARCH_DETAIL";

export interface AdminFeedbackItem {
  id: string;
  email: string;
  subject: string;
  content: string;
  feedbackSource: AdminFeedbackSource | null;
  stationId: string | null;
  stationName: string | null;
  searchId: string | null;
  originName: string | null;
  destinationName: string | null;
  status: AdminFeedbackStatus;
  createdAt: string;
  resolvedAt: string | null;
}

interface AdminFeedbackPage {
  items: AdminFeedbackItem[];
  nextCursor: string | null;
}

function isAdminFeedbackStatus(value: unknown): value is AdminFeedbackStatus {
  return value === "NEW" || value === "IN_PROGRESS" || value === "RESOLVED";
}

function isAdminFeedbackSource(value: unknown): value is AdminFeedbackSource {
  return (
    value === "HOME" ||
    value === "NEARBY" ||
    value === "NEARBY_DETAIL" ||
    value === "SEARCH" ||
    value === "SEARCH_DETAIL"
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAdminFeedbackItem(value: unknown): value is AdminFeedbackItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.email === "string" &&
    typeof item.subject === "string" &&
    typeof item.content === "string" &&
    (item.feedbackSource === null || isAdminFeedbackSource(item.feedbackSource)) &&
    isNullableString(item.stationId) &&
    isNullableString(item.stationName) &&
    isNullableString(item.searchId) &&
    isNullableString(item.originName) &&
    isNullableString(item.destinationName) &&
    isAdminFeedbackStatus(item.status) &&
    typeof item.createdAt === "string" &&
    isNullableString(item.resolvedAt)
  );
}

function parseAdminFeedbackPage(value: unknown): AdminFeedbackPage | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.items) ||
    !page.items.every(isAdminFeedbackItem) ||
    (page.nextCursor !== null && typeof page.nextCursor !== "string")
  ) {
    return null;
  }
  return { items: page.items, nextCursor: page.nextCursor };
}

function getErrorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "문의 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  const body = value as Record<string, unknown>;
  return typeof body.message === "string"
    ? body.message
    : "문의 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

async function fetchAdminFeedbackPage({
  status,
  pageParam,
  signal,
}: {
  status: AdminFeedbackStatusFilter;
  pageParam: string | null;
  signal: AbortSignal;
}): Promise<AdminFeedbackPage> {
  const query = new URLSearchParams();
  if (status !== "ALL") query.set("status", status);
  if (pageParam) query.set("cursor", pageParam);

  const response = await fetch(`/api/admin/feedback?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(getErrorMessage(body));

  const page = parseAdminFeedbackPage(body);
  if (!page) throw new Error("문의 응답 형식이 올바르지 않습니다.");
  return page;
}

export function useAdminFeedback(status: AdminFeedbackStatusFilter) {
  const query = useInfiniteQuery({
    queryKey: ["admin-feedback", status],
    queryFn: ({ pageParam, signal }) => fetchAdminFeedbackPage({ status, pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const { fetchNextPage, refetch } = query;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const isLoading = query.isPending || query.isFetchingNextPage;
  const error = query.error instanceof Error ? query.error.message : null;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const retry = useCallback(() => void refetch(), [refetch]);

  return {
    items,
    isLoading,
    error,
    hasNextPage: query.hasNextPage,
    loadMore,
    retry,
  };
}
