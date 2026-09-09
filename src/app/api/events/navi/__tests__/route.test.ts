import { describe, expect, it, vi } from "vitest";

const logNaviClickMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/event-service", () => ({
  logNaviClick: (...args: unknown[]) => logNaviClickMock(...args),
}));

import { POST } from "../route";

function validBody() {
  return {
    searchId: "s-1",
    app: "KAKAO",
    rank: 1,
    tier: "DETOUR",
    netSaving: 3252,
    detourDistanceM: 12400,
  };
}

function request(body: unknown) {
  return new Request("https://example.com/api/events/navi", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/events/navi", () => {
  it("바디가 스키마에 안 맞으면 400이다", async () => {
    const res = await POST(request({ app: "KAKAO" }));
    expect(res.status).toBe(400);
    expect(logNaviClickMock).not.toHaveBeenCalled();
  });

  it("유효하면 logNaviClick을 호출하고 204를 반환한다", async () => {
    const res = await POST(request(validBody()));
    expect(res.status).toBe(204);
    expect(logNaviClickMock).toHaveBeenCalledWith(validBody());
  });
});
