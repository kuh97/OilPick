import { FeedbackRequestSchema } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { FeedbackRateLimitError, submitFeedback } from "@/services/feedback-service";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, FeedbackRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await submitFeedback(parsed.data);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackRateLimitError) {
      return Response.json(
        { code: "RATE_LIMITED", message: "문의 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429 },
      );
    }

    // 이메일·제목·내용을 포함할 수 있는 error 객체는 로그에 남기지 않습니다.
    console.error("[POST /api/feedback] 문의 저장 실패");
    return Response.json(
      { code: "INTERNAL_ERROR", message: "문의 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
