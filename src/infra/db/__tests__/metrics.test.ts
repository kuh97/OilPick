import { describe, expect, it, vi } from "vitest";
import type { Db } from "../client";
import { getSuccessMetrics } from "../metrics";

function fakeDb() {
  const t3Query = {
    from: vi.fn().mockResolvedValue([{ rate: "0.4" }]),
  };
  const clickQuery = {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        groupBy: vi.fn().mockResolvedValue([
          { hasT3: true, clickRate: "0.25" },
          { hasT3: false, clickRate: "0.5" },
        ]),
      })),
    })),
  };
  const db = {
    select: vi.fn()
      .mockReturnValueOnce(t3Query)
      .mockReturnValueOnce(clickQuery),
  } as unknown as Db;
  return { db, t3Query, clickQuery };
}

describe("getSuccessMetrics", () => {
  it("T3 발동률과 T3 유무별 내비 연결률을 반환한다", async () => {
    const { db } = fakeDb();

    await expect(getSuccessMetrics(db)).resolves.toEqual({
      t3TriggerRate: 0.4,
      naviClickRate: { withT3: 0.25, withoutT3: 0.5 },
    });
  });
});
