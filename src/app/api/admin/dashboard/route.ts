import { NextResponse } from "next/server";
import { AdminDashboardQuerySchema } from "@/app/api/_lib/schema";
import { parseSearchParams } from "@/app/api/_lib/validate";
import { requireAdminSession } from "@/lib/admin-session";
import { getAdminDashboard } from "@/services/admin-dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const parsed = parseSearchParams(new URL(request.url), AdminDashboardQuerySchema);
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
    return adminResponse(await getAdminDashboard({ range: parsed.data.range }));
  } catch {
    return adminResponse(
      { code: "ADMIN_DATA_UNAVAILABLE", message: "운영 지표를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }
}
