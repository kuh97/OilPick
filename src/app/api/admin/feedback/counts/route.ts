import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-session";
import { getAdminFeedbackCounts } from "@/services/admin-feedback-service";

function adminResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function GET() {
  try {
    if (!(await requireAdminSession())) {
      return adminResponse(
        { code: "UNAUTHORIZED", message: "관리자 로그인이 필요합니다." },
        401,
      );
    }

    return adminResponse({ counts: await getAdminFeedbackCounts() });
  } catch {
    return adminResponse(
      { code: "ADMIN_DATA_UNAVAILABLE", message: "문의 건수를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }
}
