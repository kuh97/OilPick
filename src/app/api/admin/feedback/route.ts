import { NextResponse } from "next/server";
import { AdminFeedbackQuerySchema } from "@/app/api/_lib/schema";
import { parseSearchParams } from "@/app/api/_lib/validate";
import { requireAdminSession } from "@/lib/admin-session";
import { getAdminFeedbackList } from "@/services/admin-feedback-service";

function adminResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function GET(request: Request) {
  const parsed = parseSearchParams(new URL(request.url), AdminFeedbackQuerySchema);
  if (!parsed.ok) {
    parsed.response.headers.set("Cache-Control", "no-store");
    parsed.response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return parsed.response;
  }

  try {
    if (!(await requireAdminSession())) {
      return adminResponse(
        { code: "UNAUTHORIZED", message: "관리자 로그인이 필요합니다." },
        401,
      );
    }

    const page = await getAdminFeedbackList(parsed.data);
    return adminResponse(page);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_ADMIN_FEEDBACK_CURSOR") {
      return adminResponse(
        { code: "INVALID_REQUEST", message: "문의 목록 커서가 올바르지 않습니다." },
        400,
      );
    }
    return adminResponse(
      { code: "ADMIN_DATA_UNAVAILABLE", message: "문의 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }
}
