import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({ env: { OPINET_BACKFILL_LIMIT: 280 } }));
vi.mock("@/infra/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/infra/db/repositories", () => ({
  findStationsNeedingDetailBackfill: vi.fn(),
  countStationsNeedingDetailBackfill: vi.fn(),
  updateDetailFields: vi.fn(),
  markDetailSyncedEmpty: vi.fn(),
}));

import { backfillDetails } from "../detail-backfill-service";
import {
  findStationsNeedingDetailBackfill,
  countStationsNeedingDetailBackfill,
  updateDetailFields,
  markDetailSyncedEmpty,
} from "@/infra/db/repositories";
import type { OpinetDetailItem } from "@/infra/opinet/schema";

const findQueue = vi.mocked(findStationsNeedingDetailBackfill);
const countRemaining = vi.mocked(countStationsNeedingDetailBackfill);
const updateFields = vi.mocked(updateDetailFields);
const markEmpty = vi.mocked(markDetailSyncedEmpty);

/** detailById.do 응답 1건 (mapDetailItem이 파싱 가능한 최소 형태). */
function detailItem(id: string, over: Partial<OpinetDetailItem> = {}): OpinetDetailItem {
  return {
    UNI_ID: id,
    POLL_DIV_CO: "SKE",
    OS_NM: `주유소 ${id}`,
    GIS_X_COOR: 300000,
    GIS_Y_COOR: 500000,
    MAINT_YN: "Y",
    CAR_WASH_YN: "Y",
    KPETRO_YN: "N",
    CVS_YN: "N",
    TEL: "02-000-0000",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateFields.mockResolvedValue(undefined);
  markEmpty.mockResolvedValue(0);
  countRemaining.mockResolvedValue(0);
});

describe("backfillDetails", () => {
  it("큐가 비어 있으면 상세 API를 호출하지 않고 0을 반환한다", async () => {
    findQueue.mockResolvedValue([]);
    const fetchDetail = vi.fn();

    const r = await backfillDetails({}, { fetchDetail });

    expect(fetchDetail).not.toHaveBeenCalled();
    expect(r).toEqual({ limit: 280, picked: 0, updated: 0, notFound: 0, failed: 0, remaining: 0 });
    expect(updateFields).not.toHaveBeenCalled();
  });

  it("env.OPINET_BACKFILL_LIMIT를 큐 조회 limit으로 넘긴다", async () => {
    findQueue.mockResolvedValue([]);
    await backfillDetails({}, { fetchDetail: vi.fn() });
    expect(findQueue).toHaveBeenCalledWith(280, expect.anything());
  });

  it("인자로 받은 limit이 env보다 우선한다", async () => {
    findQueue.mockResolvedValue([]);
    await backfillDetails({ limit: 5 }, { fetchDetail: vi.fn() });
    expect(findQueue).toHaveBeenCalledWith(5, expect.anything());
  });

  it("응답이 있는 건은 updateDetailFields로, 없는 건은 markDetailSyncedEmpty로 처리한다", async () => {
    findQueue.mockResolvedValue(["A0000001", "A0000002", "A0000003"]);
    countRemaining.mockResolvedValue(7);
    const fetchDetail = vi.fn(async ({ uniId }: { uniId: string }) => {
      if (uniId === "A0000002") return null; // 오피넷에 없음
      return detailItem(uniId, uniId === "A0000001" ? { CAR_WASH_YN: "Y" } : { CAR_WASH_YN: "N" });
    });

    const now = new Date("2026-09-07T00:00:00.000Z");
    const r = await backfillDetails({}, { fetchDetail, now });

    expect(r).toEqual({ limit: 280, picked: 3, updated: 2, notFound: 0, failed: 0, remaining: 7 });
    expect(updateFields).toHaveBeenCalledTimes(2);
    expect(markEmpty).toHaveBeenCalledWith(["A0000002"], expect.anything(), now);

    const first = updateFields.mock.calls.find((c) => c[0].id === "A0000001")![0];
    expect(first).toMatchObject({
      id: "A0000001",
      hasCarWash: true,
      hasMaintenance: true,
      isKpetro: false,
      tel: "02-000-0000",
    });
  });

  it("큐의 id를 정본으로 써서 UPDATE 대상을 고른다 (응답 UNI_ID가 달라도)", async () => {
    findQueue.mockResolvedValue(["A0000009"]);
    const fetchDetail = vi.fn().mockResolvedValue(detailItem("Z9999999"));

    await backfillDetails({}, { fetchDetail });

    expect(updateFields.mock.calls[0][0].id).toBe("A0000009");
  });

  it("상세 API 호출이 throw하면 그 건은 failed로 집계하고 나머지는 계속 처리한다", async () => {
    findQueue.mockResolvedValue(["A0000001", "A0000002"]);
    countRemaining.mockResolvedValue(1);
    const fetchDetail = vi.fn(async ({ uniId }: { uniId: string }) => {
      if (uniId === "A0000001") throw new Error("timeout");
      return detailItem(uniId);
    });

    const r = await backfillDetails({}, { fetchDetail });

    expect(r).toMatchObject({ picked: 2, updated: 1, failed: 1, notFound: 0 });
    expect(updateFields).toHaveBeenCalledTimes(1);
    expect(markEmpty).toHaveBeenCalledWith([], expect.anything(), expect.anything());
  });
});
