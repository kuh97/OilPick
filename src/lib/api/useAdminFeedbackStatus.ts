"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminFeedbackItem, AdminFeedbackStatus } from "@/lib/api/useAdminFeedback";

interface UpdateAdminFeedbackStatusInput {
  id: string;
  status: AdminFeedbackStatus;
}

function getErrorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "문의 상태를 변경할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  const body = value as Record<string, unknown>;
  return typeof body.message === "string"
    ? body.message
    : "문의 상태를 변경할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

function isAdminFeedbackStatus(value: unknown): value is AdminFeedbackStatus {
  return value === "NEW" || value === "IN_PROGRESS" || value === "RESOLVED";
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
    isNullableString(item.stationId) &&
    isNullableString(item.searchId) &&
    isAdminFeedbackStatus(item.status) &&
    typeof item.createdAt === "string" &&
    isNullableString(item.resolvedAt)
  );
}

async function updateAdminFeedbackStatus({
  id,
  status,
}: UpdateAdminFeedbackStatusInput): Promise<AdminFeedbackItem> {
  const response = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ status }),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(getErrorMessage(body));

  if (typeof body !== "object" || body === null) {
    throw new Error("문의 상태 응답 형식이 올바르지 않습니다.");
  }
  const item = (body as Record<string, unknown>).item;
  if (!isAdminFeedbackItem(item)) {
    throw new Error("문의 상태 응답 형식이 올바르지 않습니다.");
  }
  return item;
}

export function useAdminFeedbackStatus() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateAdminFeedbackStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-feedback"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-feedback-counts"] }),
      ]);
    },
  });

  return {
    updateStatus: mutation.mutate,
    isUpdating: mutation.isPending,
    updatingId: mutation.variables?.id ?? null,
    error: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
