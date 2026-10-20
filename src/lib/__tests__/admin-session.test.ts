import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, headersMock, isAdminSessionValidMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  headersMock: vi.fn(),
  isAdminSessionValidMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock, headers: headersMock }));
vi.mock("@/services/admin-auth-service", () => ({
  ADMIN_COOKIE_NAME: "__Host-oilpick-admin",
  isAdminSessionValid: isAdminSessionValidMock,
}));

import { requireAdminSession } from "../admin-session";

describe("requireAdminSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    headersMock.mockResolvedValue(new Headers());
    cookiesMock.mockResolvedValue({ get: vi.fn(() => undefined) });
    isAdminSessionValidMock.mockResolvedValue(false);
  });

  it("E2E 전용 헤더는 production이 아니고 전용 토큰과 일치할 때만 통과시킨다", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_ADMIN_BYPASS_TOKEN", "test-token");
    headersMock.mockResolvedValue(new Headers({ "x-oilpick-e2e-admin": "test-token" }));

    await expect(requireAdminSession()).resolves.toBe(true);
    expect(isAdminSessionValidMock).not.toHaveBeenCalled();
  });

  it("production에서는 E2E 전용 헤더를 무시하고 일반 세션을 확인한다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_ADMIN_BYPASS_TOKEN", "test-token");
    headersMock.mockResolvedValue(new Headers({ "x-oilpick-e2e-admin": "test-token" }));
    cookiesMock.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    isAdminSessionValidMock.mockResolvedValue(true);

    await expect(requireAdminSession()).resolves.toBe(true);
    expect(isAdminSessionValidMock).toHaveBeenCalledWith("session-token");
  });
});
