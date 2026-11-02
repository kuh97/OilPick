import { describe, expect, it } from "vitest";
import {
  parseMetaDate,
  parseOilCsv,
  parseLpgCsv,
  parsePriceCsvPair,
  mergeCsvRows,
  mapBrandLabel,
  decodeEucKr,
} from "../parse";

describe("parseMetaDate", () => {
  it("\"기준 : 일간(20260904~20260904)\"에서 ISO 날짜를 뽑는다", () => {
    expect(parseMetaDate("기준 : 일간(20260904~20260904)")).toBe("2026-09-04");
  });

  it("날짜가 없으면 에러를 던진다(G2)", () => {
    expect(() => parseMetaDate("이상한 메타행")).toThrow();
  });

  it("일일 범위의 시작일과 종료일이 다르면 거부한다(G2)", () => {
    expect(() => parseMetaDate("기준 : 일간(20260904~20260905)")).toThrow(/시작일과 종료일/);
  });

  it("실재하지 않는 날짜를 거부한다(G2)", () => {
    expect(() => parseMetaDate("기준 : 일간(20260230~20260230)")).toThrow(/유효하지/);
  });
});

describe("mapBrandLabel", () => {
  it("실측 대조표(MIGRATION-DB.md §3.3)대로 변환한다", () => {
    expect(mapBrandLabel("SK에너지")).toBe("SKE");
    expect(mapBrandLabel("GS칼텍스")).toBe("GSC");
    expect(mapBrandLabel("HD현대오일뱅크")).toBe("HDO");
    expect(mapBrandLabel("S-OIL")).toBe("SOL");
    expect(mapBrandLabel("NH-OIL")).toBe("NHO");
    expect(mapBrandLabel("알뜰주유소")).toBe("RTO");
    expect(mapBrandLabel("알뜰(ex)")).toBe("RTX");
    expect(mapBrandLabel("자가상표")).toBe("ETC");
    expect(mapBrandLabel("E1")).toBe("E1G");
    expect(mapBrandLabel("SK가스")).toBe("SKG");
  });

  it("모르는 상표는 원본 텍스트를 그대로 반환한다(죽지 않음)", () => {
    expect(mapBrandLabel("신규브랜드")).toBe("신규브랜드");
  });
});

const OIL_CSV = [
  '"번호","지역","상호","주소","기간","상표","셀프여부","고급휘발유","휘발유","경유","실내등유"',
  '"기준 : 일간(20260904~20260904)"',
  '"A0033584","강원 강릉시","(주)강릉햇살 유천주유소","강원도 강릉시 사임당로 178(유천동)","20260904","HD현대오일뱅크","셀프","2230","1809","1789","0"',
  '"A0011352","강원 강릉시","(주)대성길","강원 강릉시 구정면 칠성로 187","20260904","S-OIL","일반","0","1859","1859","1600"',
].join("\n");

const LPG_CSV = [
  '"번호","지역","상호","주소","기간","상표","셀프여부","LPG"',
  '"기준 : 일간(20260904~20260904)"',
  '"A0011521","강원 강릉시","(주)강릉개인택시충전소"," 강원도 강릉시 강변로 636-5","20260904","GS칼텍스","일반","1124"',
  '"A0033584","강원 강릉시","(주)강릉햇살 유천주유소","강원도 강릉시 사임당로 178(유천동)","20260904","HD현대오일뱅크","일반","1180"',
].join("\n");

describe("parseOilCsv", () => {
  it("메타행을 스킵하고 기준일자·행을 파싱한다", () => {
    const { pricedOn, rows } = parseOilCsv(OIL_CSV);
    expect(pricedOn).toBe("2026-09-04");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      uniId: "A0033584",
      region: "강원 강릉시",
      name: "(주)강릉햇살 유천주유소",
      address: "강원도 강릉시 사임당로 178(유천동)",
      brandLabel: "HD현대오일뱅크",
      isSelf: true,
      pricePremium: 2230,
      priceGasoline: 1809,
      priceDiesel: 1789,
      priceKerosene: null, // "0" → 미취급
    });
  });

  it("셀프여부=일반이면 isSelf=false", () => {
    const { rows } = parseOilCsv(OIL_CSV);
    expect(rows[1].isSelf).toBe(false);
  });

  it("고급휘발유=0이면 미취급(null)", () => {
    const { rows } = parseOilCsv(OIL_CSV);
    expect(rows[1].pricePremium).toBeNull();
  });

  it("헤더가 다르면 에러를 던진다(G1)", () => {
    const bad = OIL_CSV.replace("고급휘발유", "프리미엄휘발유");
    expect(() => parseOilCsv(bad)).toThrow(/G1/);
  });

  it("행의 기간이 메타 기준일자와 다르면 거부한다(G2)", () => {
    const bad = OIL_CSV.replace(
      '"A0011352","강원 강릉시","(주)대성길","강원 강릉시 구정면 칠성로 187","20260904"',
      '"A0011352","강원 강릉시","(주)대성길","강원 강릉시 구정면 칠성로 187","20260903"',
    );
    expect(() => parseOilCsv(bad)).toThrow(/행의 기간.*메타 기준일자/);
  });
});

describe("parseLpgCsv", () => {
  it("충전소 CSV를 파싱한다", () => {
    const { pricedOn, rows } = parseLpgCsv(LPG_CSV);
    expect(pricedOn).toBe("2026-09-04");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      uniId: "A0011521",
      region: "강원 강릉시",
      name: "(주)강릉개인택시충전소",
      address: " 강원도 강릉시 강변로 636-5",
      brandLabel: "GS칼텍스",
      isSelf: false,
      priceLpg: 1124,
    });
  });
});

describe("parsePriceCsvPair", () => {
  it("두 CSV의 기준일자가 같으면 공통 기준일을 반환한다", () => {
    const result = parsePriceCsvPair(OIL_CSV, LPG_CSV);
    expect(result.pricedOn).toBe("2026-09-04");
  });

  it("주유소와 LPG의 기준일자가 다르면 거부한다(G2)", () => {
    const staleLpg = LPG_CSV.replaceAll("20260904", "20260903");
    expect(() => parsePriceCsvPair(OIL_CSV, staleLpg)).toThrow(/주유소\/LPG CSV 기준일자/);
  });
});

describe("mergeCsvRows", () => {
  const sigunMap = new Map([["강원 강릉시", "0301"]]);

  it("주유소만 있으면 energyType=OIL", () => {
    const { rows: oil } = parseOilCsv(OIL_CSV);
    const merged = mergeCsvRows([oil[1]], [], sigunMap, "2026-09-04"); // A0011352는 lpg csv에 없음
    expect(merged).toHaveLength(1);
    expect(merged[0].energyType).toBe("OIL");
    expect(merged[0].sigunCd).toBe("0301");
  });

  it("충전소만 있으면 energyType=LPG", () => {
    const { rows: lpg } = parseLpgCsv(LPG_CSV);
    const merged = mergeCsvRows([], [lpg[0]], sigunMap, "2026-09-04"); // A0011521은 oil csv에 없음
    expect(merged[0].energyType).toBe("LPG");
    expect(merged[0].priceLpg).toBe(1124);
  });

  it("두 CSV 모두에 있으면(겸업) energyType=BOTH로 합쳐진다", () => {
    const { rows: oil } = parseOilCsv(OIL_CSV);
    const { rows: lpg } = parseLpgCsv(LPG_CSV);
    // A0033584는 두 CSV 모두에 존재
    const merged = mergeCsvRows(oil, lpg, sigunMap, "2026-09-04");
    const combined = merged.find((m) => m.uniId === "A0033584")!;
    expect(combined.energyType).toBe("BOTH");
    expect(combined.priceGasoline).toBe(1809);
    expect(combined.priceLpg).toBe(1180);
  });

  it("sigunMap에 없는 지역은 sigunCd=null", () => {
    const { rows: oil } = parseOilCsv(OIL_CSV);
    const merged = mergeCsvRows(oil, [], new Map(), "2026-09-04");
    expect(merged.every((m) => m.sigunCd === null)).toBe(true);
  });
});

describe("decodeEucKr", () => {
  it("EUC-KR 바이트를 UTF-8 문자열로 디코딩한다", () => {
    // "강릉" EUC-KR 바이트
    const buf = Buffer.from([0xb0, 0xad, 0xb8, 0xaa]);
    expect(decodeEucKr(buf)).toBe("강릉");
  });
});
