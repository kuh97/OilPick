"use client";

export interface FeedbackPayload {
  email: string;
  subject: string;
  content: string;
  stationId?: string;
  searchId?: string;
}

export interface FeedbackError {
  code: string;
  message: string;
}

export function useFeedback() {
  async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: true } | { ok: false; error: FeedbackError }> {
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<FeedbackError> & { ok?: boolean };

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: body.code ?? "REQUEST_FAILED",
            message: body.message ?? "문의 접수에 실패했습니다.",
          },
        };
      }

      return { ok: true };
    } catch {
      return {
        ok: false,
        error: { code: "NETWORK_ERROR", message: "네트워크가 불안정합니다. 잠시 후 다시 시도해주세요." },
      };
    }
  }

  return { submitFeedback };
}
