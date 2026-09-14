import { describe, expect, it, vi } from "vitest";
import { gridSnapWgs84 } from "@/infra/cache/keys";
import { wgs84 } from "@/domain/types";
import type { Candidate, SearchResult } from "@/domain/types";
import type { Db } from "@/infra/db/client";
import { logNaviClick, logSearch } from "../event-service";

function fakeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
  return { db, values };
}

function candidate(id: string, tier: Candidate["tier"]): Candidate {
  return {
    station: {
      id,
      name: id,
      brandCode: "SKE",
      energyType: "OIL",
      location: wgs84(37.5, 127.0),
      facilities: { carWash: false, maintenance: false, cvs: false },
      isKpetro: false,
    },
    price: 1700,
    dPerp: 100,
    tier,
    detour: { precise: true, distanceM: 300, durationS: 30 },
    netSaving: 450,
    totalCost: 76000,
    scores: { balanced: 1, minCost: 2, minDistance: 3 },
    reason: "테스트",
  };
}

function searchResult(): SearchResult {
  return {
    searchId: "11111111-1111-4111-8111-111111111111",
    baseRoute: { distanceM: 10000, durationS: 1200, polyline: [wgs84(37.5, 127.0)] },
    candidates: [candidate("on-route", "ON_ROUTE"), candidate("detour", "DETOUR")],
    referencePrice: 1800,
    refPriceSource: "MEDIAN_T1T2",
    expansion: { triggered: true, finalRadiusM: 5000 },
    warnings: [{ code: "TIMEOUT", message: "일부 계산이 완료되지 않았습니다." }],
    stage: "DETOUR",
    minutesNeededForOneResult: null,
  };
}

describe("event-service — 익명 이벤트 저장", () => {
  it("검색 이벤트에 격자 스냅 좌표와 집계 정보만 저장한다", async () => {
    const { db, values } = fakeDb();
    const origin = wgs84(37.5665, 126.978);
    const destination = wgs84(35.1151, 129.0422);

    await logSearch(searchResult(), {
      durationMs: 2500,
      fuel: "GASOLINE",
      filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: false },
      origin,
      destination,
      routeCalls: 4,
      jsonFallback: true,
      db,
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      originCell: gridSnapWgs84(origin),
      destCell: gridSnapWgs84(destination),
      t1Count: 1,
      t2Count: 0,
      t3Count: 1,
      routeCalls: 4,
      jsonFallback: true,
      warnings: ["TIMEOUT"],
    }));
    expect(JSON.stringify(values.mock.calls[0][0])).not.toContain("서울시청");
  });

  it("딥링크 클릭 이벤트를 search_id와 함께 저장한다", async () => {
    const { db, values } = fakeDb();

    await logNaviClick({
      searchId: "11111111-1111-4111-8111-111111111111",
      app: "KAKAO",
      rank: 1,
      tier: "DETOUR",
      netSaving: 3252,
      detourDistanceM: 12400,
    }, db);

    expect(values).toHaveBeenCalledWith({
      searchId: "11111111-1111-4111-8111-111111111111",
      app: "KAKAO",
      rank: 1,
      tier: "DETOUR",
      netSaving: 3252,
      detourDistanceM: 12400,
    });
  });
});
