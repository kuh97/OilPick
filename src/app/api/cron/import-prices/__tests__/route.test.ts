import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({ env: { CRON_SECRET: "test-secret" } }));

const getLatestPriceCsvs = vi.fn();
vi.mock("@/infra/blob/price-csv", () => ({ getLatestPriceCsvs: (...a: unknown[]) => getLatestPriceCsvs(...a) }));

const importPrices = vi.fn();
vi.mock("@/services/price-import-service", () => ({ importPrices: (...a: unknown[]) => importPrices(...a) }));

const writeCsvImportLog = vi.fn();
vi.mock("@/infra/db/repositories", () => ({ writeCsvImportLog: (...a: unknown[]) => writeCsvImportLog(...a) }));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://x/api/cron/import-prices", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  writeCsvImportLog.mockResolvedValue(undefined);
});

describe("GET /api/cron/import-prices", () => {
  it("Authorization 헤더가 없거나 틀리면 401", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(importPrices).not.toHaveBeenCalled();
  });

  it("Blob에 CSV가 없으면 DOWNLOAD_FAILED를 200으로 응답하고 로그를 남긴다", async () => {
    getLatestPriceCsvs.mockRejectedValue(new Error("opinet/latest/ 없음"));

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "DOWNLOAD_FAILED" });
    expect(writeCsvImportLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DOWNLOAD_FAILED" }),
    );
    expect(importPrices).not.toHaveBeenCalled();
  });

  it("정상: Blob CSV를 importPrices에 넘기고 결과를 200으로 반환", async () => {
    getLatestPriceCsvs.mockResolvedValue({ oil: Buffer.from("oil"), lpg: Buffer.from("lpg") });
    importPrices.mockResolvedValue({ status: "OK", pricedOn: "2026-09-05", oilRows: 100, lpgRows: 5, geocoded: 0, skippedNoCoord: 0 });

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "OK", pricedOn: "2026-09-05" });
    expect(importPrices).toHaveBeenCalledWith({ oilCsv: expect.any(Buffer), lpgCsv: expect.any(Buffer) });
  });

  it("게이트 실패도 200으로 반환 (어제 데이터로 서비스 지속이 정상)", async () => {
    getLatestPriceCsvs.mockResolvedValue({ oil: Buffer.from("oil"), lpg: Buffer.from("lpg") });
    importPrices.mockResolvedValue({ status: "GATE_FAILED", gate: "G4", detail: "행 수 급감", pricedOn: "2026-09-05" });

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "GATE_FAILED", gate: "G4" });
  });
});
