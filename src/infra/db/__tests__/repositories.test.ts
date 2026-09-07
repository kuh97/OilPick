import { describe, expect, it, vi } from "vitest";
import {
  toRefuelPointInsert,
  fromRefuelPointRow,
  upsertRefuelPointFromDetail,
  findRefuelPointsByIds,
  findRefuelPointRowById,
  bulkUpsertFromCsv,
  findRefuelPointsInBbox,
  findSigunguAvgPrice,
  findSidoAvgPrice,
  findNationalAvgPrice,
  findStationsNeedingDetailBackfill,
  countStationsNeedingDetailBackfill,
  updateDetailFields,
  markDetailSyncedEmpty,
  type RefuelPointRow,
} from "../repositories";
import type { Db } from "../client";
import { OpinetDetailResponseSchema } from "@/infra/opinet/schema";
import detailFixture from "../../../../tests/fixtures/opinet-detail.json";

const detailItem = OpinetDetailResponseSchema.parse(detailFixture).RESULT.OIL[0];
const NOW = new Date("2026-08-31T00:00:00.000Z");

// ─── 순수 함수 ──────────────────────────────────────────────────────────────

describe("toRefuelPointInsert — 순수 변환", () => {
  it("UNI_ID → id, source는 항상 OPINET (폴백 C)", () => {
    const row = toRefuelPointInsert(detailItem, { now: NOW });
    expect(row.id).toBe(detailItem.UNI_ID);
    expect(row.source).toBe("OPINET");
    expect(row.detailSyncedAt).toEqual(NOW);
    expect(row.updatedAt).toEqual(NOW);
  });

  it("시설 필드가 boolean 컬럼으로 채워진다", () => {
    const row = toRefuelPointInsert(detailItem, { now: NOW });
    expect(typeof row.hasCarWash).toBe("boolean");
    expect(typeof row.hasMaintenance).toBe("boolean");
    expect(typeof row.hasCvs).toBe("boolean");
    expect(typeof row.isKpetro).toBe("boolean");
  });

  it("searchedFuel을 지정하지 않으면 가격 스냅샷이 null이다", () => {
    const row = toRefuelPointInsert(detailItem, { now: NOW });
    expect(row.lastPrice).toBeNull();
    expect(row.lastPriceProd).toBeNull();
  });

  it("searchedFuel에 맞는 OIL_PRICE 항목을 골라 가격 스냅샷을 채운다", () => {
    const withPrice = {
      ...detailItem,
      OIL_PRICE: [{ PRODCD: "B027", PRICE: 1847 }],
    };
    const row = toRefuelPointInsert(withPrice, { searchedFuel: "GASOLINE", now: NOW });
    expect(row.lastPrice).toBe(1847);
    expect(row.lastPriceProd).toBe("B027");
  });

  it("searchedFuel에 해당하는 OIL_PRICE 항목이 없으면 null로 남는다", () => {
    const withPrice = {
      ...detailItem,
      OIL_PRICE: [{ PRODCD: "D047", PRICE: 1700 }],
    };
    const row = toRefuelPointInsert(withPrice, { searchedFuel: "GASOLINE", now: NOW });
    expect(row.lastPrice).toBeNull();
  });

  it("priceTradedAt은 항상 null (오피넷 응답에 기준시각 없음, §5.1)", () => {
    const row = toRefuelPointInsert(detailItem, { now: NOW });
    expect(row.priceTradedAt).toBeNull();
  });
});

describe("fromRefuelPointRow — 순수 변환", () => {
  const baseRow: RefuelPointRow = {
    id: "A0009916",
    name: "테스트주유소",
    brandCode: "SKE",
    energyType: "OIL",
    lat: 37.5,
    lng: 127.0,
    katecX: 315069.06,
    katecY: 540497.58,
    addressRoad: "도로명",
    addressJibun: "지번",
    tel: "02-000-0000",
    sigunCd: "0101",
    hasCarWash: true,
    hasMaintenance: false,
    hasCvs: true,
    isKpetro: false,
    isSelf: null,
    coordSource: null,
    lastPrice: 1847,
    lastPriceProd: "B027",
    priceTradedAt: null,
    priceGasoline: null,
    priceDiesel: null,
    priceLpg: null,
    pricePremium: null,
    priceKerosene: null,
    pricedOn: null,
    lastSeenOn: null,
    source: "OPINET",
    detailSyncedAt: NOW,
    updatedAt: NOW,
  };

  it("좌표를 WGS84Point 브랜드 타입으로 감싼다", () => {
    const mapped = fromRefuelPointRow(baseRow);
    expect(mapped.location.lat).toBe(baseRow.lat);
    expect(mapped.location.lng).toBe(baseRow.lng);
  });

  it("katecX/katecY가 모두 있으면 katecLocation을 채운다", () => {
    const mapped = fromRefuelPointRow(baseRow);
    expect(mapped.katecLocation).toBeDefined();
    expect(mapped.katecLocation!.x).toBe(baseRow.katecX);
  });

  it("katecX/katecY가 없으면 katecLocation은 undefined", () => {
    const mapped = fromRefuelPointRow({ ...baseRow, katecX: null, katecY: null });
    expect(mapped.katecLocation).toBeUndefined();
  });

  it("null 컬럼은 undefined로 변환된다 (선택 필드)", () => {
    const mapped = fromRefuelPointRow({ ...baseRow, tel: null, sigunCd: null });
    expect(mapped.tel).toBeUndefined();
    expect(mapped.sigunCd).toBeUndefined();
  });

  it("facilities 객체로 시설 컬럼을 묶는다", () => {
    const mapped = fromRefuelPointRow(baseRow);
    expect(mapped.facilities).toEqual({ carWash: true, maintenance: false, cvs: true });
  });
});

// ─── DB 접근 함수 (주입된 fake db로 검증) ─────────────────────────────────────

function fakeInsertDb() {
  const onConflictDoUpdate = vi.fn<(opts: Record<string, unknown>) => Promise<undefined>>(
    () => Promise.resolve(undefined),
  );
  const values = vi.fn<(row: unknown) => { onConflictDoUpdate: typeof onConflictDoUpdate }>(
    () => ({ onConflictDoUpdate }),
  );
  const insert = vi.fn<(table: unknown) => { values: typeof values }>(() => ({ values }));
  return { insert, values, onConflictDoUpdate };
}

describe("upsertRefuelPointFromDetail — DB 접근", () => {
  it("refuel_point 테이블에 insert().values().onConflictDoUpdate()를 호출한다", async () => {
    const fake = fakeInsertDb();
    await upsertRefuelPointFromDetail(detailItem, { now: NOW }, fake as unknown as Db);

    expect(fake.insert).toHaveBeenCalledTimes(1);
    expect(fake.values).toHaveBeenCalledTimes(1);
    const insertedRow = fake.values.mock.calls[0][0] as RefuelPointRow;
    expect(insertedRow.id).toBe(detailItem.UNI_ID);
    expect(fake.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("가격 스냅샷이 없으면(lastPrice=null) conflict set에서 가격 필드를 생략한다", async () => {
    const fake = fakeInsertDb();
    await upsertRefuelPointFromDetail(detailItem, { now: NOW }, fake as unknown as Db);
    const opts = fake.onConflictDoUpdate.mock.calls[0][0] as { set: { lastPrice?: number } };
    expect(opts.set.lastPrice).toBeUndefined();
  });

  it("가격 스냅샷이 있으면 conflict set에 lastPrice/lastPriceProd를 포함한다", async () => {
    const fake = fakeInsertDb();
    const withPrice = { ...detailItem, OIL_PRICE: [{ PRODCD: "B027", PRICE: 1847 }] };
    await upsertRefuelPointFromDetail(
      withPrice,
      { searchedFuel: "GASOLINE", now: NOW },
      fake as unknown as Db,
    );
    const opts = fake.onConflictDoUpdate.mock.calls[0][0] as {
      set: { lastPrice?: number; lastPriceProd?: string };
    };
    expect(opts.set.lastPrice).toBe(1847);
    expect(opts.set.lastPriceProd).toBe("B027");
  });
});

describe("findRefuelPointsByIds — DB 접근", () => {
  it("빈 배열이면 DB를 조회하지 않고 빈 배열을 반환한다", async () => {
    const select = vi.fn();
    const result = await findRefuelPointsByIds([], { select } as unknown as Db);
    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("조회된 row를 도메인 RefuelPoint[]로 변환해 반환한다", async () => {
    const row = {
      id: "A0009916",
      name: "테스트",
      brandCode: "SKE",
      energyType: "OIL",
      lat: 37.5,
      lng: 127.0,
      katecX: null,
      katecY: null,
      addressRoad: null,
      addressJibun: null,
      tel: null,
      sigunCd: null,
      hasCarWash: false,
      hasMaintenance: false,
      hasCvs: false,
      isKpetro: false,
      lastPrice: null,
      lastPriceProd: null,
      priceTradedAt: null,
      source: "OPINET",
      detailSyncedAt: null,
      updatedAt: NOW,
    };
    const where = vi.fn().mockResolvedValue([row]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findRefuelPointsByIds(["A0009916"], { select } as unknown as Db);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A0009916");
    expect(result[0].location.lat).toBe(37.5);
  });
});

describe("findRefuelPointRowById — DB 접근", () => {
  it("row가 없으면 undefined를 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findRefuelPointRowById("A9999999", { select } as unknown as Db);
    expect(result).toBeUndefined();
  });

  it("lastPrice·priceTradedAt을 포함한 원본 row를 그대로 반환한다 (fromRefuelPointRow와 달리 가격을 유지)", async () => {
    const row: RefuelPointRow = {
      id: "A0009916",
      name: "테스트",
      brandCode: "SKE",
      energyType: "OIL",
      lat: 37.5,
      lng: 127.0,
      katecX: null,
      katecY: null,
      addressRoad: null,
      addressJibun: null,
      tel: null,
      sigunCd: null,
      hasCarWash: false,
      hasMaintenance: false,
      hasCvs: false,
      isKpetro: false,
      isSelf: null,
      coordSource: null,
      lastPrice: 1650,
      lastPriceProd: "B027",
      priceTradedAt: NOW,
      priceGasoline: null,
      priceDiesel: null,
      priceLpg: null,
      pricePremium: null,
      priceKerosene: null,
      pricedOn: null,
      lastSeenOn: null,
      source: "OPINET",
      detailSyncedAt: null,
      updatedAt: NOW,
    };
    const where = vi.fn().mockResolvedValue([row]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findRefuelPointRowById("A0009916", { select } as unknown as Db);
    expect(result?.lastPrice).toBe(1650);
    expect(result?.priceTradedAt).toEqual(NOW);
  });
});

describe("bulkUpsertFromCsv — DB 접근", () => {
  it("빈 배열이면 DB를 호출하지 않고 0을 반환한다", async () => {
    const insert = vi.fn();
    const result = await bulkUpsertFromCsv([], { insert } as unknown as Db, NOW);
    expect(result).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("행 수만큼 upsert를 시도하고 source='OPINET_CSV'로 넣는다", async () => {
    const fake = fakeInsertDb();
    const rows = [
      {
        id: "A0033584",
        name: "테스트주유소",
        brandCode: "HDO",
        energyType: "OIL" as const,
        lat: 37.5,
        lng: 127.0,
        coordSource: "KAKAO_ADDR",
        addressRoad: "강원도 강릉시 사임당로 178",
        sigunCd: "0301",
        isSelf: true,
        pricedOn: "2026-09-04",
        lastSeenOn: "2026-09-04",
        priceGasoline: 1809,
        priceDiesel: 1789,
        priceLpg: null,
        pricePremium: 2230,
        priceKerosene: null,
      },
    ];
    const result = await bulkUpsertFromCsv(rows, fake as unknown as Db, NOW);
    expect(result).toBe(1);
    expect(fake.insert).toHaveBeenCalledTimes(1);
    const insertedRows = fake.values.mock.calls[0][0] as Array<{ source: string }>;
    expect(insertedRows[0].source).toBe("OPINET_CSV");
  });

  it("onConflictDoUpdate의 SET 절에 시설정보·detail 컬럼을 넣지 않는다 (컬럼 소유권 규칙)", async () => {
    const fake = fakeInsertDb();
    const rows = [
      {
        id: "A0033584",
        name: "테스트주유소",
        brandCode: "HDO",
        energyType: "OIL" as const,
        lat: 37.5,
        lng: 127.0,
        coordSource: "KAKAO_ADDR",
        addressRoad: "강원도 강릉시 사임당로 178",
        sigunCd: "0301",
        isSelf: true,
        pricedOn: "2026-09-04",
        lastSeenOn: "2026-09-04",
        priceGasoline: 1809,
        priceDiesel: 1789,
        priceLpg: null,
        pricePremium: 2230,
        priceKerosene: null,
      },
    ];
    await bulkUpsertFromCsv(rows, fake as unknown as Db, NOW);
    const [opts] = fake.onConflictDoUpdate.mock.calls[0];
    const setKeys = Object.keys((opts as { set: Record<string, unknown> }).set);
    for (const forbidden of ["hasCarWash", "hasMaintenance", "hasCvs", "isKpetro", "tel", "detailSyncedAt", "source"]) {
      expect(setKeys).not.toContain(forbidden);
    }
  });
});

describe("findRefuelPointsInBbox — DB 접근", () => {
  it("bbox 안의 row를 station+price+pricedOn으로 매핑한다", async () => {
    const row = {
      id: "A0033584",
      name: "테스트주유소",
      brandCode: "SKE",
      energyType: "OIL",
      lat: 37.5,
      lng: 127.0,
      katecX: null,
      katecY: null,
      addressRoad: null,
      addressJibun: null,
      tel: null,
      sigunCd: "0301",
      hasCarWash: false,
      hasMaintenance: false,
      hasCvs: false,
      isKpetro: false,
      isSelf: true,
      coordSource: "KAKAO_ADDR",
      lastPrice: null,
      lastPriceProd: null,
      priceTradedAt: null,
      priceGasoline: 1809,
      priceDiesel: 1789,
      priceLpg: null,
      pricePremium: null,
      priceKerosene: null,
      pricedOn: "2026-09-04",
      lastSeenOn: "2026-09-04",
      source: "OPINET_CSV",
      detailSyncedAt: null,
      updatedAt: NOW,
    };
    const where = vi.fn().mockResolvedValue([row]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findRefuelPointsInBbox(
      { minLat: 37, maxLat: 38, minLng: 126, maxLng: 128 },
      "GASOLINE",
      NOW,
      { select } as unknown as Db,
    );

    expect(result).toHaveLength(1);
    expect(result[0].station.id).toBe("A0033584");
    expect(result[0].price).toBe(1809); // GASOLINE → price_gasoline
    expect(result[0].pricedOn).toBe("2026-09-04");
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findRefuelPointsInBbox(
      { minLat: 37, maxLat: 38, minLng: 126, maxLng: 128 },
      "LPG",
      NOW,
      { select } as unknown as Db,
    );
    expect(result).toEqual([]);
  });
});

describe("findSigunguAvgPrice — DB 접근", () => {
  it("행이 있으면 avgPrice를 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ avgPrice: 1900 }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findSigunguAvgPrice("0101", "GASOLINE", { select } as unknown as Db);
    expect(result).toBe(1900);
  });

  it("행이 없으면 null을 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findSigunguAvgPrice("9999", "LPG", { select } as unknown as Db);
    expect(result).toBeNull();
  });
});

describe("findSidoAvgPrice — DB 접근", () => {
  it("평균값이 있으면 반올림한 정수를 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ avgPrice: "1905.6" }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findSidoAvgPrice("01", "GASOLINE", { select } as unknown as Db);
    expect(result).toBe(1906);
  });

  it("평균값이 없으면(null) null을 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ avgPrice: null }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findSidoAvgPrice("99", "LPG", { select } as unknown as Db);
    expect(result).toBeNull();
  });
});

describe("findNationalAvgPrice — DB 접근", () => {
  it("평균값이 있으면 반올림한 정수를 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ avgPrice: "1780.2" }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findNationalAvgPrice("DIESEL", { select } as unknown as Db);
    expect(result).toBe(1780);
  });

  it("평균값이 없으면(null) null을 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ avgPrice: null }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findNationalAvgPrice("LPG", { select } as unknown as Db);
    expect(result).toBeNull();
  });
});

// ─── 시설정보 백필 (Phase E) ────────────────────────────────────────────────

describe("findStationsNeedingDetailBackfill — DB 접근", () => {
  it("select→from→where→orderBy→limit 체인을 태우고 id 배열만 뽑아 반환한다", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "A0000001" }, { id: "A0000002" }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findStationsNeedingDetailBackfill(280, { select } as unknown as Db);

    expect(result).toEqual(["A0000001", "A0000002"]);
    expect(limit).toHaveBeenCalledWith(280);
  });

  it("대상이 없으면 빈 배열을 반환한다", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await findStationsNeedingDetailBackfill(50, { select } as unknown as Db);
    expect(result).toEqual([]);
  });
});

describe("countStationsNeedingDetailBackfill — DB 접근", () => {
  it("count 결과를 숫자로 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([{ n: 8_800 }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await countStationsNeedingDetailBackfill({ select } as unknown as Db);
    expect(result).toBe(8_800);
  });

  it("행이 없으면 0을 반환한다", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await countStationsNeedingDetailBackfill({ select } as unknown as Db);
    expect(result).toBe(0);
  });
});

describe("updateDetailFields — DB 접근", () => {
  it("SET 절에 상세 API 소유 컬럼만 넣는다 (CSV 소유 컬럼 제외)", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn<(v: Record<string, unknown>) => { where: typeof where }>(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const now = new Date("2026-09-07T00:00:00.000Z");

    await updateDetailFields(
      {
        id: "A0000001",
        hasCarWash: true,
        hasMaintenance: false,
        hasCvs: true,
        isKpetro: false,
        tel: "02-123-4567",
      },
      { update } as unknown as Db,
      now,
    );

    const setArg = set.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(setArg).sort()).toEqual(
      ["detailSyncedAt", "hasCarWash", "hasCvs", "hasMaintenance", "isKpetro", "tel", "updatedAt"].sort(),
    );
    for (const forbidden of ["name", "brandCode", "addressRoad", "sigunCd", "energyType", "lat", "lng", "priceGasoline"]) {
      expect(setArg).not.toHaveProperty(forbidden);
    }
    expect(setArg.detailSyncedAt).toBe(now);
  });
});

describe("markDetailSyncedEmpty — DB 접근", () => {
  it("빈 배열이면 DB를 호출하지 않고 0을 반환한다", async () => {
    const update = vi.fn();
    const result = await markDetailSyncedEmpty([], { update } as unknown as Db);
    expect(result).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("id 목록에 detail_synced_at만 채우는 UPDATE를 실행하고 건수를 반환한다", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn<(v: Record<string, unknown>) => { where: typeof where }>(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const now = new Date("2026-09-07T00:00:00.000Z");

    const result = await markDetailSyncedEmpty(["A1", "A2", "A3"], { update } as unknown as Db, now);

    expect(result).toBe(3);
    const setArg = set.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(setArg).sort()).toEqual(["detailSyncedAt", "updatedAt"].sort());
  });
});
