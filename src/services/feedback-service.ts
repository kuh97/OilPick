/** 사용자 문의 저장 — docs/ADMIN-DASHBOARD.md §4.1·§7. */

import { getRedis } from "@/infra/cache/redis";
import { env } from "@/infra/env";
import { insertAdminFeedback } from "@/infra/db/repositories";
import { sendFeedbackNotification } from "@/infra/email/resend";
import type { Db } from "@/infra/db/client";
import type { RedisLike } from "./route-service";

const FEEDBACK_RATE_LIMIT = 30;
const FEEDBACK_RATE_WINDOW_SECONDS = 60 * 60;

export interface FeedbackInput {
  email: string;
  subject: string;
  content: string;
  stationId?: string;
  searchId?: string;
}

export interface SubmitFeedbackDeps {
  db?: Db;
  redis?: Pick<RedisLike, "incrby" | "expire">;
  prefix?: string;
  now?: Date;
  sendNotification?: (input: FeedbackInput) => Promise<void>;
}

export class FeedbackRateLimitError extends Error {
  constructor() {
    super("feedback rate limit exceeded");
    this.name = "FeedbackRateLimitError";
  }
}

function feedbackRateLimitKey(prefix: string, now: Date): string {
  const window = Math.floor(now.getTime() / (FEEDBACK_RATE_WINDOW_SECONDS * 1_000));
  return `${prefix}:feedback:rate:${window}`;
}

async function applyRateLimit(
  redis: Pick<RedisLike, "incrby" | "expire">,
  prefix: string,
  now: Date,
): Promise<void> {
  const count = await redis.incrby(feedbackRateLimitKey(prefix, now), 1);
  if (count === 1) {
    await redis.expire(feedbackRateLimitKey(prefix, now), FEEDBACK_RATE_WINDOW_SECONDS);
  }
  if (count > FEEDBACK_RATE_LIMIT) throw new FeedbackRateLimitError();
}

export async function submitFeedback(input: FeedbackInput, deps: SubmitFeedbackDeps = {}): Promise<void> {
  const redis = deps.redis ?? getRedis();
  const prefix = deps.prefix ?? env.REDIS_KEY_PREFIX;
  const now = deps.now ?? new Date();

  try {
    await applyRateLimit(redis, prefix, now);
  } catch (error) {
    if (error instanceof FeedbackRateLimitError) throw error;
    // 요청 제한 저장소가 잠시 멈춰도 문의 자체는 받을 수 있게 합니다.
    // 이메일·제목·내용은 로그에 남기지 않습니다.
    console.error("[feedback] 요청 제한 확인 실패");
  }

  await insertAdminFeedback(
    {
      email: input.email,
      subject: input.subject,
      content: input.content,
      stationId: input.stationId ?? null,
      searchId: input.searchId ?? null,
    },
    deps.db,
  );

  try {
    await (deps.sendNotification ?? sendFeedbackNotification)(input);
  } catch {
    // 문의 저장은 성공했으므로 이메일 제공업체 장애가 접수를 막지 않게 합니다.
    // 이메일·제목·내용은 로그에 남기지 않습니다.
    console.error("[feedback] 문의 이메일 알림 실패");
  }
}
