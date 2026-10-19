import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/infra/db/client";
import { FeedbackRateLimitError, submitFeedback } from "../feedback-service";

const { insertAdminFeedbackMock } = vi.hoisted(() => ({ insertAdminFeedbackMock: vi.fn() }));

vi.mock("@/infra/db/repositories", () => ({
  insertAdminFeedback: (...args: unknown[]) => insertAdminFeedbackMock(...args),
}));

interface FakeRedis {
  count: number;
  incrby: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
}

function fakeRedis(count = 1): FakeRedis {
  return {
    count,
    incrby: vi.fn().mockResolvedValue(count),
    expire: vi.fn().mockResolvedValue(1),
  };
}

const INPUT = {
  email: "user@example.com",
  subject: "주유소 정보 오류",
  content: "세차장 정보가 실제와 달라요.",
  stationId: "station-1",
  searchId: "11111111-1111-4111-8111-111111111111",
};

describe("feedback-service", () => {
  beforeEach(() => {
    insertAdminFeedbackMock.mockReset();
    insertAdminFeedbackMock.mockResolvedValue(undefined);
  });

  it("요청 제한을 확인하고 문의를 DB 저장 형식으로 넘긴다", async () => {
    const redis = fakeRedis();
    const db = {} as Db;

    await submitFeedback(INPUT, {
      redis,
      db,
      prefix: "test",
      now: new Date("2026-10-19T00:00:00.000Z"),
    });

    expect(redis.incrby).toHaveBeenCalledWith(expect.stringMatching(/^test:feedback:rate:\d+$/), 1);
    expect(redis.expire).toHaveBeenCalledWith(expect.stringMatching(/^test:feedback:rate:\d+$/), 60 * 60);
    expect(insertAdminFeedbackMock).toHaveBeenCalledWith(
      { ...INPUT, stationId: "station-1", searchId: "11111111-1111-4111-8111-111111111111" },
      db,
    );
  });

  it("제한을 넘으면 문의를 저장하지 않는다", async () => {
    const redis = fakeRedis(31);

    await expect(submitFeedback(INPUT, { redis, prefix: "test" })).rejects.toBeInstanceOf(FeedbackRateLimitError);
    expect(insertAdminFeedbackMock).not.toHaveBeenCalled();
  });

  it("Redis 제한 확인이 실패해도 문의 저장은 계속한다", async () => {
    const redis = fakeRedis();
    redis.incrby.mockRejectedValueOnce(new Error("redis unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await submitFeedback(INPUT, { redis, prefix: "test" });

    expect(insertAdminFeedbackMock).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith("[feedback] 요청 제한 확인 실패");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(INPUT.email);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(INPUT.content);
    errorSpy.mockRestore();
  });
});
