import { NextResponse } from "next/server";
import { AdminLoginRequestSchema } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  authenticateAdminPassword,
} from "@/services/admin-auth-service";

function adminResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, AdminLoginRequestSchema);
  if (!parsed.ok) {
    parsed.response.headers.set("Cache-Control", "no-store");
    parsed.response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return parsed.response;
  }

  try {
    const result = await authenticateAdminPassword(parsed.data.password);
    if (!result.ok && result.reason === "UNCONFIGURED") {
      return adminResponse(
        {
          code: "ADMIN_AUTH_UNAVAILABLE",
          message: "관리자 인증 설정이 준비되지 않았습니다.",
        },
        503,
      );
    }
    if (!result.ok && result.reason === "RATE_LIMITED") {
      return adminResponse(
        {
          code: "RATE_LIMITED",
          message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        },
        429,
      );
    }
    if (!result.ok) {
      return adminResponse(
        { code: "INVALID_PASSWORD", message: "비밀번호가 올바르지 않습니다." },
        401,
      );
    }

    const response = adminResponse({ ok: true });
    response.cookies.set(ADMIN_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      // __Host- 접두사 쿠키는 운영·로컬 모두 Secure가 필요하다.
      // 브라우저는 localhost를 Secure 쿠키 허용 대상으로 취급한다.
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: ADMIN_SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    return adminResponse(
      {
        code: "ADMIN_AUTH_UNAVAILABLE",
        message:
          "관리자 인증을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      },
      503,
    );
  }
}
