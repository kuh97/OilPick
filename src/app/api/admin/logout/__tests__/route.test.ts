import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGetMock, revokeAdminSessionMock } = vi.hoisted(() => ({
  cookieGetMock: vi.fn(),
  revokeAdminSessionMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

vi.mock("@/services/admin-auth-service", () => ({
  ADMIN_COOKIE_NAME: "__Host-oilpick-admin",
  revokeAdminSession: revokeAdminSessionMock,
}));

import { POST } from "../route";

describe("POST /api/admin/logout", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
    revokeAdminSessionMock.mockReset();
    revokeAdminSessionMock.mockResolvedValue(undefined);
  });

  it("현재 세션을 폐기하고 HttpOnly 쿠키를 만료시킨다", async () => {
    cookieGetMock.mockReturnValue({ value: "session-token" });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revokeAdminSessionMock).toHaveBeenCalledWith("session-token");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-oilpick-admin=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });
});
