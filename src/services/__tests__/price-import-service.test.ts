import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/csv/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infra/csv/parse")>();
  return { ...actual, decodeEucKr: (buf: Buffer) => buf.toString("utf-8") };
});
vi.mock("@/infra/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/infra/db/repositories", () => ({
  getLastSuccessfulImport: vi.fn(),
  getExistingStationCoords: vi.fn(),
  resetStaging: vi.fn(),
  loadStaging: vi.fn(),
  swapStagingToRefuelPoint: vi.fn(),
  writeCsvImportLog: vi.fn(),
}));

import { importPrices } from "../price-import-service";
import {
  getLastSuccessfulImport,
  getExistingStationCoords,
  resetStaging,
  loadStaging,
  swapStagingToRefuelPoint,
  writeCsvImportLog,
} from "@/infra/db/repositories";

const getLastImport = vi.mocked(getLastSuccessfulImport);
const getCoords = vi.mocked(getExistingStationCoords);
const reset = vi.mocked(resetStaging);
const load = vi.mocked(loadStaging);
const swap = vi.mocked(swapStagingToRefuelPoint);
const writeLog = vi.mocked(writeCsvImportLog);

const SIGUN_MAP = new Map([["서울 강남구", "1168"]]);

function oilCsv(count = 100, pricedOn = "20260905"): Buffer {
  const header = "번호,지역,상호,주소,기간,상표,셀프여부,고급휘발유,휘발유,경유,실내등유";
  const meta = `기준 : 일간(${pricedOn}~${pricedOn})`;
  const rows = Array.from({ length: count }, (_, i) => {
    const id = `A${String(i).padStart(7, "0")}`;
    return `${id},서울 강남구,주유소${i},서울 강남구 테헤란로 ${i},${pricedOn},SK에너지,셀프,0,1700,1600,0`;
  });
  return Buffer.from([header, meta, ...rows].join("\n"), "utf-8");
}

function lpgCsv(count = 5, pricedOn = "20260905"): Buffer {
  const header = "번호,지역,상호,주소,기간,상표,셀프여부,LPG";
  const meta = `기준 : 일간(${pricedOn}~${pricedOn})`;
  const rows = Array.from({ length: count }, (_, i) => {
    const id = `A${String(9_000 + i).padStart(7, "0")}`;
    return `${id},서울 강남구,충전소${i},서울 강남구 역삼로 ${i},${pricedOn},SK가스,일반,1100`;
  });
  return Buffer.from([header, meta, ...rows].join("\n"), "utf-8");
}

type CoordRow = { lat: number | null; lng: number | null; coordSource: string | null };

/** 기존 마스터 좌표 맵 — 주유소 `oil`개 + 충전소 `lpg`개에 좌표를 채운다 (지오코딩 불필요 + G6 통과). */
function coordsFor(oil = 100, lpg = 5): Map<string, CoordRow> {
  const at: CoordRow = { lat: 37.5, lng: 127.03, coordSource: "OPINET" };
  return new Map<string, CoordRow>([
    ...Array.from({ length: oil }, (_, i) => [`A${String(i).padStart(7, "0")}`, at] as const),
    ...Array.from({ length: lpg }, (_, i) => [`A${String(9_000 + i).padStart(7, "0")}`, at] as const),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  getLastImport.mockResolvedValue(null);
  getCoords.mockResolvedValue(coordsFor(100));
  reset.mockResolvedValue(undefined);
  load.mockResolvedValue(0);
  swap.mockResolvedValue(undefined);
  writeLog.mockResolvedValue(undefined);
});

const deps = () => ({ db: {} as never, sigunMap: SIGUN_MAP, geocode: vi.fn() });

describe("importPrices — 정상 경로", () => {
  it("게이트 통과 → 스테이징 적재 → 스왑 → OK 로그", async () => {
    const result = await importPrices({ oilCsv: oilCsv(), lpgCsv: lpgCsv() }, deps());

    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.pricedOn).toBe("2026-09-05");
    expect(result.oilRows).toBe(100);
    expect(result.lpgRows).toBe(5);

    // 스왑 전에 스테이징을 비우고, 적재 후 스왑한다
    expect(reset).toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toHaveLength(105); // 좌표 있는 105행 전부
    expect(swap).toHaveBeenCalledTimes(1);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(swap.mock.invocationCallOrder[0]);

    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OK", pricedOn: "2026-09-05", oilRows: 100 }),
      expect.anything(),
    );
  });

  it("기존 좌표가 없는 신규 행은 지오코딩하고, 실패한 행은 스테이징에서 빠진다", async () => {
    getCoords.mockResolvedValue(coordsFor(98)); // A0000098·A0000099는 신규
    const d = deps();
    d.geocode
      .mockResolvedValueOnce({ lat: 37.4, lng: 127.1, coordSource: "KAKAO_ADDR" }) // A0000098
      .mockResolvedValueOnce(null); // A0000099 실패

    const result = await importPrices({ oilCsv: oilCsv(), lpgCsv: lpgCsv(0) }, d);

    expect(d.geocode).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.geocoded).toBe(1);
    expect(result.skippedNoCoord).toBe(1);
    expect(load.mock.calls[0][0]).toHaveLength(99); // 100 - 1 좌표실패
  });
});

describe("importPrices — 실패 경로 (refuel_point 무변경)", () => {
  it("헤더가 깨지면 G1으로 로그하고 스왑하지 않는다", async () => {
    const badHeader = Buffer.from("잘못,된,헤더\n기준 : 일간(20260905~20260905)\nA0000001,x", "utf-8");
    const result = await importPrices({ oilCsv: badHeader, lpgCsv: lpgCsv() }, deps());

    expect(result).toMatchObject({ status: "GATE_FAILED", gate: "G1" });
    expect(swap).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "GATE_FAILED", failedGate: "G1" }),
      expect.anything(),
    );
  });

  it("G4(행 수 급감) 실패 시 스왑하지 않고 GATE_FAILED 로그", async () => {
    getLastImport.mockResolvedValue({ pricedOn: "2026-09-04", oilRows: 100, lpgRows: 5 });
    const result = await importPrices({ oilCsv: oilCsv(50), lpgCsv: lpgCsv() }, deps());

    expect(result).toMatchObject({ status: "GATE_FAILED", gate: "G4" });
    expect(swap).not.toHaveBeenCalled();
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "GATE_FAILED", failedGate: "G4", pricedOn: "2026-09-05" }),
      expect.anything(),
    );
  });

  it("G3(같은 파일 재수입) 실패", async () => {
    getLastImport.mockResolvedValue({ pricedOn: "2026-09-05", oilRows: 100, lpgRows: 5 });
    const result = await importPrices({ oilCsv: oilCsv(), lpgCsv: lpgCsv() }, deps());
    expect(result).toMatchObject({ status: "GATE_FAILED", gate: "G3" });
    expect(swap).not.toHaveBeenCalled();
  });
});
