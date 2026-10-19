import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, revokeAdminSession } from "@/services/admin-auth-service";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;

  try {
    await revokeAdminSession(token);
  } catch {
    // 브라우저 쿠키는 만료시켜도 Redis가 잠시 불안정하면 서버 세션이 남을 수 있다.
    // 세션 TTL이 끝나도록 민감한 값을 로그에 남기지 않고 응답은 계속 반환한다.
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
