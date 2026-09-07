import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({ env: { CRON_SECRET: "test-secret" } }));

const backfillDetails = vi.fn();
vi.mock("@/services/detail-backfill-service", () => ({
  backfillDetails: (...a: unknown[]) => backfillDetails(...a),
}));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://x/api/cron/backfill-details", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cron/backfill-details", () => {
  it("Authorization 헤더가 없거나 틀리면 401", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(backfillDetails).not.toHaveBeenCalled();
  });

  it("정상: 서비스 결과를 200으로 반환", async () => {
    backfillDetails.mockResolvedValue({
      limit: 280,
      picked: 280,
      updated: 271,
      notFound: 3,
      failed: 6,
      remaining: 8_800,
    });

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ picked: 280, updated: 271, remaining: 8_800 });
  });

  it("큐가 비면 0을 200으로 반환", async () => {
    backfillDetails.mockResolvedValue({
      limit: 280,
      picked: 0,
      updated: 0,
      notFound: 0,
      failed: 0,
      remaining: 0,
    });

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ picked: 0, remaining: 0 });
  });
});
