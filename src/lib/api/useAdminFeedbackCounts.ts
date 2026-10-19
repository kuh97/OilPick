"use client";

import { useQuery } from "@tanstack/react-query";

export interface AdminFeedbackCounts {
  ALL: number;
  NEW: number;
  IN_PROGRESS: number;
  RESOLVED: number;
}

function isAdminFeedbackCounts(value: unknown): value is AdminFeedbackCounts {
  if (typeof value !== "object" || value === null) return false;
  const counts = value as Record<string, unknown>;
  return ["ALL", "NEW", "IN_PROGRESS", "RESOLVED"].every(
    (key) => typeof counts[key] === "number" && Number.isInteger(counts[key]) && counts[key] >= 0,
  );
}

function getErrorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "문의 건수를 불러올 수 없습니다.";
  }
  const body = value as Record<string, unknown>;
  return typeof body.message === "string" ? body.message : "문의 건수를 불러올 수 없습니다.";
}

async function fetchAdminFeedbackCounts(): Promise<AdminFeedbackCounts> {
  const response = await fetch("/api/admin/feedback/counts", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(getErrorMessage(body));

  if (typeof body !== "object" || body === null) {
    throw new Error("문의 건수 응답 형식이 올바르지 않습니다.");
  }
  const payload = body as Record<string, unknown>;
  if (!isAdminFeedbackCounts(payload.counts)) {
    throw new Error("문의 건수 응답 형식이 올바르지 않습니다.");
  }
  return payload.counts;
}

export function useAdminFeedbackCounts() {
  const query = useQuery({
    queryKey: ["admin-feedback-counts"],
    queryFn: fetchAdminFeedbackCounts,
  });

  return {
    counts: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
