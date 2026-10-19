import { NextResponse } from "next/server";
import { AdminFeedbackStatusUpdateSchema } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { requireAdminSession } from "@/lib/admin-session";
import {
  updateAdminFeedbackStatus,
  type AdminFeedbackStatus,
} from "@/services/admin-feedback-service";

function adminResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(request, AdminFeedbackStatusUpdateSchema);
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

    const { id } = await params;
    if (!id) {
      return adminResponse(
        { code: "INVALID_REQUEST", message: "문의 ID가 필요합니다." },
        400,
      );
    }

    const item = await updateAdminFeedbackStatus({
      id,
      status: parsed.data.status as AdminFeedbackStatus,
    });
    if (!item) {
      return adminResponse(
        { code: "NOT_FOUND", message: "문의를 찾을 수 없습니다." },
        404,
      );
    }

    return adminResponse({ item });
  } catch {
    return adminResponse(
      { code: "ADMIN_DATA_UNAVAILABLE", message: "문의 상태를 변경할 수 없습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }
}
