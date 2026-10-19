/** 관리자 인증 — docs/ADMIN-DASHBOARD.md §3. */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/infra/cache/redis";
import { env } from "@/infra/env";

export const ADMIN_COOKIE_NAME = "__Host-oilpick-admin";
export const ADMIN_SESSION_TTL_SECONDS = 2 * 60 * 60;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const ADMIN_LOGIN_FAILURE_LIMIT = 10;
const ADMIN_LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

export interface AdminRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface AdminAuthDeps {
  redis?: AdminRedis;
  prefix?: string;
  now?: Date;
  randomBytes?: (size: number) => Buffer;
}

export type AdminLoginResult =
  | { ok: true; sessionToken: string }
  | { ok: false; reason: "UNCONFIGURED" | "INVALID_PASSWORD" | "RATE_LIMITED" };

interface AdminAuthConfig {
  passwordHash: string;
  sessionSecret: string;
}

function getAdminAuthConfig(): AdminAuthConfig | null {
  const passwordHash = env.ADMIN_PASSWORD_HASH?.trim();
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim();
  if (!passwordHash || !sessionSecret) return null;
  return { passwordHash, sessionSecret };
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function formatPasswordHash(salt: Buffer, derivedKey: Buffer): string {
  // `.env.local`에서 `$`는 Next.js 환경변수 치환 문자로 해석될 수 있으므로
  // 생성 형식은 환경변수에 안전한 `:` 구분자를 사용한다.
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, encode(salt), encode(derivedKey)].join(":");
}

function parsePasswordHash(value: string): {
  salt: Buffer;
  derivedKey: Buffer;
  N: number;
  r: number;
  p: number;
} | null {
  const separator = value.startsWith("scrypt$") ? "$" : value.startsWith("scrypt:") ? ":" : null;
  if (!separator) return null;
  const parts = value.split(separator);
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every(Number.isSafeInteger) || N <= 1 || r <= 0 || p <= 0) return null;

  try {
    const salt = decode(parts[4]);
    const derivedKey = decode(parts[5]);
    if (salt.length < 16 || derivedKey.length === 0) return null;
    return { salt, derivedKey, N, r, p };
  } catch {
    return null;
  }
}

async function derivePasswordKey(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N, r, p, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function resolveRedis(deps: AdminAuthDeps): AdminRedis {
  return deps.redis ?? (getRedis() as unknown as AdminRedis);
}

/** 운영 환경변수에 넣을 scrypt 해시를 생성하는 일회성 헬퍼. 평문은 반환값에 포함하지 않는다. */
export async function createAdminPasswordHash(
  password: string,
  randomBytesFn: (size: number) => Buffer = randomBytes,
): Promise<string> {
  const salt = randomBytesFn(16);
  const derivedKey = await derivePasswordKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return formatPasswordHash(salt, derivedKey);
}

export async function verifyAdminPassword(password: string, passwordHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) return false;

  try {
    const derivedKey = await derivePasswordKey(password, parsed.salt, parsed.N, parsed.r, parsed.p);
    return derivedKey.length === parsed.derivedKey.length && timingSafeEqual(derivedKey, parsed.derivedKey);
  } catch {
    return false;
  }
}

function sessionDigest(sessionSecret: string, token: string): string {
  return createHmac("sha256", sessionSecret).update(token).digest("hex");
}

function sessionKey(prefix: string, sessionSecret: string, token: string): string {
  return `${prefix}:admin:session:${sessionDigest(sessionSecret, token)}`;
}

function failureKey(prefix: string, now: Date): string {
  const window = Math.floor(now.getTime() / (ADMIN_LOGIN_FAILURE_WINDOW_SECONDS * 1_000));
  return `${prefix}:admin:login-failure:${window}`;
}

function isAtFailureLimit(value: string | null): boolean {
  return value !== null && Number(value) >= ADMIN_LOGIN_FAILURE_LIMIT;
}

async function recordLoginFailure(redis: AdminRedis, prefix: string, now: Date): Promise<boolean> {
  const key = failureKey(prefix, now);
  const count = await redis.incrby(key, 1);
  if (count === 1) await redis.expire(key, ADMIN_LOGIN_FAILURE_WINDOW_SECONDS);
  return count > ADMIN_LOGIN_FAILURE_LIMIT;
}

export async function authenticateAdminPassword(
  password: string,
  deps: AdminAuthDeps = {},
): Promise<AdminLoginResult> {
  const config = getAdminAuthConfig();
  if (!config) return { ok: false, reason: "UNCONFIGURED" };

  const redis = resolveRedis(deps);
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const now = deps.now ?? new Date();
  const failures = await redis.get(failureKey(prefix, now));
  if (isAtFailureLimit(failures)) return { ok: false, reason: "RATE_LIMITED" };

  const valid = await verifyAdminPassword(password, config.passwordHash);
  if (!valid) {
    const limited = await recordLoginFailure(redis, prefix, now);
    return { ok: false, reason: limited ? "RATE_LIMITED" : "INVALID_PASSWORD" };
  }

  const token = (deps.randomBytes ?? randomBytes)(32).toString("base64url");
  await redis.set(sessionKey(prefix, config.sessionSecret, token), "1", { ex: ADMIN_SESSION_TTL_SECONDS });
  return { ok: true, sessionToken: token };
}

export async function isAdminSessionValid(token: string | undefined, deps: AdminAuthDeps = {}): Promise<boolean> {
  if (!token) return false;
  const config = getAdminAuthConfig();
  if (!config) return false;

  const redis = resolveRedis(deps);
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const stored = await redis.get(sessionKey(prefix, config.sessionSecret, token));
  return stored !== null;
}

export async function revokeAdminSession(token: string | undefined, deps: AdminAuthDeps = {}): Promise<void> {
  if (!token) return;
  const config = getAdminAuthConfig();
  if (!config) return;

  const redis = resolveRedis(deps);
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  await redis.del(sessionKey(prefix, config.sessionSecret, token));
}
