import { describe, expect, it, vi } from "vitest";
import { collectStations } from "../station-service";
import { wgs84ToProjected } from "@/domain/geo";
import { wgs84 } from "@/domain/types";
import type { RefuelPoint } from "@/domain/types";
import type { BboxRefuelPointResult } from "@/infra/db/repositories";

const ORIGIN = wgs84ToProjected(wgs84(37.42, 127.12));
const DEST = wgs84ToProjected(wgs84(37.5, 127.2));
const NOW = new Date("2026-09-05T03:00:00.000Z");

function refuelPoint(overrides: Partial<RefuelPoint> = {}): RefuelPoint {
  return {
    id: "A0000001",
    name: "테스트주유소",
    brandCode: "SKE",
    energyType: "OIL",
    location: wgs84(37.46, 127.16),
    facilities: { carWash: false, maintenance: false, cvs: false },
    isKpetro: false,
    ...overrides,
  };
}

function bboxRow(overrides: Partial<BboxRefuelPointResult> = {}): BboxRefuelPointResult {
  return {
    station: refuelPoint(),
    price: 1700,
    pricedOn: "2026-09-04",
    ...overrides,
  };
}

const noFilters = { facilities: [], brands: [], kpetroOnly: false, selfOnly: false };

describe("collectStations — bbox 계산", () => {
  it("기준 지점들 + marginM으로 bbox를 만들어 findRefuelPointsInBbox에 넘긴다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([]);
    await collectStations({
      referencePoints: [ORIGIN, DEST],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: noFilters,
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(findInBbox).toHaveBeenCalledTimes(1);
    const [bbox, fuel, now] = findInBbox.mock.calls[0];
    expect(bbox.minLat).toBeLessThan(37.42);
    expect(bbox.maxLat).toBeGreaterThan(37.5);
    expect(bbox.minLng).toBeLessThan(127.12);
    expect(bbox.maxLng).toBeGreaterThan(127.2);
    expect(fuel).toBe("GASOLINE");
    expect(now).toBe(NOW);
  });

  it("marginM이 클수록 bbox가 넓어진다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([]);
    await collectStations({
      referencePoints: [ORIGIN],
      marginM: 5_000,
      fuel: "LPG",
      filters: noFilters,
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });
    const narrowBbox = findInBbox.mock.calls[0][0];

    findInBbox.mockClear();
    await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "LPG",
      filters: noFilters,
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });
    const wideBbox = findInBbox.mock.calls[0][0];

    expect(wideBbox.maxLat - wideBbox.minLat).toBeGreaterThan(narrowBbox.maxLat - narrowBbox.minLat);
  });
});

describe("collectStations — 결과 매핑", () => {
  it("findRefuelPointsInBbox 결과를 station·price·pricedOn 그대로 돌려준다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([bboxRow()]);
    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: noFilters,
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations).toHaveLength(1);
    expect(result.stations[0].price).toBe(1700);
    expect(result.stations[0].pricedOn).toBe("2026-09-04");
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([]);
    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: noFilters,
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });
    expect(result.stations).toEqual([]);
  });
});

describe("collectStations — 필터 적용", () => {
  it("시설 필터를 모두 만족하지 않으면 제외한다", async () => {
    const findInBbox = vi
      .fn()
      .mockResolvedValue([bboxRow({ station: refuelPoint({ facilities: { carWash: false, maintenance: false, cvs: false } }) })]);

    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: { facilities: ["CAR_WASH"], brands: [], kpetroOnly: false, selfOnly: false },
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations).toHaveLength(0);
  });

  it("brands 필터에 없는 브랜드는 제외한다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([bboxRow({ station: refuelPoint({ brandCode: "GSC" }) })]);

    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: { facilities: [], brands: ["SKE"], kpetroOnly: false, selfOnly: false },
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations).toHaveLength(0);
  });

  it("kpetroOnly=true면 알뜰주유소가 아닌 곳은 제외한다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([bboxRow({ station: refuelPoint({ isKpetro: false }) })]);

    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: { facilities: [], brands: [], kpetroOnly: true, selfOnly: false },
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations).toHaveLength(0);
  });

  it("selfOnly=true면 셀프가 아닌 곳과 셀프여부 미상인 곳을 제외한다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([
      bboxRow({ station: refuelPoint({ id: "A1", isSelf: true }) }),
      bboxRow({ station: refuelPoint({ id: "A2", isSelf: false }) }),
      bboxRow({ station: refuelPoint({ id: "A3", isSelf: undefined }) }),
    ]);

    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: { facilities: [], brands: [], kpetroOnly: false, selfOnly: true },
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations.map((s) => s.station.id)).toEqual(["A1"]);
  });

  it("필터를 모두 만족하면 포함한다", async () => {
    const findInBbox = vi.fn().mockResolvedValue([
      bboxRow({
        station: refuelPoint({
          brandCode: "SKE",
          isKpetro: true,
          facilities: { carWash: true, maintenance: false, cvs: false },
        }),
      }),
    ]);

    const result = await collectStations({
      referencePoints: [ORIGIN],
      marginM: 15_000,
      fuel: "GASOLINE",
      filters: { facilities: ["CAR_WASH"], brands: ["SKE"], kpetroOnly: true, selfOnly: false },
      now: NOW,
      findRefuelPointsInBbox: findInBbox,
    });

    expect(result.stations).toHaveLength(1);
  });
});
