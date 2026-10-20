"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

interface DeleteAdminFeedbackInput {
  id: string;
}

function getErrorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "문의를 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  const body = value as Record<string, unknown>;
  return typeof body.message === "string"
    ? body.message
    : "문의를 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

async function deleteAdminFeedback({ id }: DeleteAdminFeedbackInput): Promise<void> {
  const response = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(getErrorMessage(body));

  if (typeof body !== "object" || body === null || (body as Record<string, unknown>).ok !== true) {
    throw new Error("문의 삭제 응답 형식이 올바르지 않습니다.");
  }
}

export function useAdminFeedbackDelete() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: deleteAdminFeedback,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-feedback"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-feedback-counts"] }),
      ]);
    },
  });

  return {
    deleteFeedback: mutation.mutate,
    isDeleting: mutation.isPending,
    deletingId: mutation.variables?.id ?? null,
    error: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
