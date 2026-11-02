import { describe, expect, it, vi } from "vitest";

vi.mock("../parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parse")>();
  return {
    ...actual,
    decodeEucKr: (buf: Buffer | ArrayBuffer) =>
      Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("utf-8"),
  };
});

import { validateDownloadedPriceCsvs } from "../validate-download";

function oilCsv(pricedOn: string): Buffer {
  return Buffer.from(
    [
      "번호,지역,상호,주소,기간,상표,셀프여부,고급휘발유,휘발유,경유,실내등유",
      `기준 : 일간(${pricedOn}~${pricedOn})`,
      `A0000001,서울 강남구,주유소,서울 강남구 테헤란로 1,${pricedOn},SK에너지,셀프,0,1700,1600,0`,
    ].join("\n"),
    "utf-8",
  );
}

function lpgCsv(pricedOn: string): Buffer {
  return Buffer.from(
    [
      "번호,지역,상호,주소,기간,상표,셀프여부,LPG",
      `기준 : 일간(${pricedOn}~${pricedOn})`,
      `A0000002,서울 강남구,충전소,서울 강남구 역삼로 1,${pricedOn},SK가스,일반,1100`,
    ].join("\n"),
    "utf-8",
  );
}

describe("validateDownloadedPriceCsvs", () => {
  it("요청일·주유소·LPG 기준일이 모두 같으면 검증된 archive 날짜를 반환한다", () => {
    const result = validateDownloadedPriceCsvs(oilCsv("20261101"), lpgCsv("20261101"), "20261101");
    expect(result).toEqual({
      pricedOn: "2026-11-01",
      archiveDate: "20261101",
      oilRows: 1,
      lpgRows: 1,
    });
  });

  it("오피넷이 요청일보다 오래된 파일을 반환하면 Blob 업로드 전에 거부한다", () => {
    expect(() =>
      validateDownloadedPriceCsvs(oilCsv("20261031"), lpgCsv("20261031"), "20261101"),
    ).toThrow(/요청=20261101, 실제=20261031.*Blob 업로드를 중단/);
  });

  it("두 파일의 기준일자가 다르면 거부한다", () => {
    expect(() =>
      validateDownloadedPriceCsvs(oilCsv("20261101"), lpgCsv("20261031"), "20261101"),
    ).toThrow(/주유소\/LPG CSV 기준일자/);
  });
});
