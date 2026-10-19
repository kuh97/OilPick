import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateAdminPasswordMock } = vi.hoisted(() => ({
  authenticateAdminPasswordMock: vi.fn(),
}));

vi.mock("@/services/admin-auth-service", () => ({
  ADMIN_COOKIE_NAME: "__Host-oilpick-admin",
  ADMIN_SESSION_TTL_SECONDS: 7_200,
  authenticateAdminPassword: authenticateAdminPasswordMock,
}));

import { POST } from "../route";

function request(body: unknown) {
  return new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    authenticateAdminPasswordMock.mockReset();
  });

  it("비밀번호가 없으면 400이고 인증 서비스를 호출하지 않는다", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(authenticateAdminPasswordMock).not.toHaveBeenCalled();
  });

  it("올바른 비밀번호 결과에는 HttpOnly 세션 쿠키만 발급한다", async () => {
    authenticateAdminPasswordMock.mockResolvedValue({ ok: true, sessionToken: "session-token" });

    const response = await POST(request({ password: "correct-password" }));

    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-oilpick-admin=session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=7200");
    expect(cookie).not.toContain("correct-password");
    expect(responseBody).not.toContain("session-token");
  });

  it("잘못된 비밀번호는 401을 반환하고 쿠키를 발급하지 않는다", async () => {
    authenticateAdminPasswordMock.mockResolvedValue({ ok: false, reason: "INVALID_PASSWORD" });

    const response = await POST(request({ password: "wrong-password" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "INVALID_PASSWORD",
      message: "비밀번호가 올바르지 않습니다.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("인증 설정이 없으면 503으로 닫힌다", async () => {
    authenticateAdminPasswordMock.mockResolvedValue({ ok: false, reason: "UNCONFIGURED" });

    const response = await POST(request({ password: "any-password" }));

    expect(response.status).toBe(503);
  });
});
