import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_TTL_SECONDS,
  authenticateAdminPassword,
  createAdminPasswordHash,
  isAdminSessionValid,
  revokeAdminSession,
  verifyAdminPassword,
  type AdminRedis,
} from "../admin-auth-service";

function fakeRedis(): AdminRedis & { store: Map<string, string>; expirations: Map<string, number> } {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();
  return {
    store,
    expirations,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, options) {
      store.set(key, value);
      if (options?.ex) expirations.set(key, options.ex);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async incrby(key, increment) {
      const value = Number(store.get(key) ?? "0") + increment;
      store.set(key, String(value));
      return value;
    },
    async expire(key, seconds) {
      expirations.set(key, seconds);
      return 1;
    },
  };
}

describe("admin-auth-service", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await createAdminPasswordHash("correct-password", () => Buffer.alloc(16, 7));
    vi.stubEnv("ADMIN_PASSWORD_HASH", passwordHash);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-session-secret");
    vi.stubEnv("REDIS_KEY_PREFIX", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scrypt 해시를 검증하고 다른 비밀번호는 거부한다", async () => {
    expect(passwordHash.startsWith("scrypt:")).toBe(true);
    await expect(verifyAdminPassword("correct-password", passwordHash)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong-password", passwordHash)).resolves.toBe(false);
    await expect(verifyAdminPassword("correct-password", "not-a-scrypt-hash")).resolves.toBe(false);
  });

  it("설정이 없으면 관리자 인증을 열지 않는다", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    const redis = fakeRedis();

    await expect(authenticateAdminPassword("correct-password", { redis, now })).resolves.toEqual({
      ok: false,
      reason: "UNCONFIGURED",
    });
    expect(redis.store).toHaveLength(0);
  });

  it("올바른 비밀번호는 Redis 세션을 만들고 TTL을 설정한다", async () => {
    const redis = fakeRedis();
    const result = await authenticateAdminPassword("correct-password", {
      redis,
      now,
      randomBytes: () => Buffer.alloc(32, 8),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionToken).not.toContain(passwordHash);
    expect(redis.store).toHaveLength(1);
    expect([...redis.expirations.values()]).toContain(ADMIN_SESSION_TTL_SECONDS);
    await expect(isAdminSessionValid(result.sessionToken, { redis })).resolves.toBe(true);

    await revokeAdminSession(result.sessionToken, { redis });
    await expect(isAdminSessionValid(result.sessionToken, { redis })).resolves.toBe(false);
  });

  it("잘못된 비밀번호가 10회를 넘으면 로그인 시도를 제한한다", async () => {
    const redis = fakeRedis();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(authenticateAdminPassword("wrong-password", { redis, now })).resolves.toEqual({
        ok: false,
        reason: "INVALID_PASSWORD",
      });
    }
    await expect(authenticateAdminPassword("wrong-password", { redis, now })).resolves.toEqual({
      ok: false,
      reason: "RATE_LIMITED",
    });
    await expect(authenticateAdminPassword("correct-password", { redis, now })).resolves.toEqual({
      ok: false,
      reason: "RATE_LIMITED",
    });
  });
});
