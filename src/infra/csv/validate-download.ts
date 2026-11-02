import { decodeEucKr, parsePriceCsvPair } from "./parse";

export interface ValidatedPriceCsvDownload {
  pricedOn: string;
  archiveDate: string;
  oilRows: number;
  lpgRows: number;
}

/**
 * 오피넷이 요청일 대신 마지막 생성 파일을 반환하는 경우를 Blob 업로드 전에 차단합니다.
 * 자동 수급은 단일 일자 스냅샷만 허용하며, archive 이름은 검증된 파일 기준일을 씁니다.
 */
export function validateDownloadedPriceCsvs(
  oilCsv: Buffer | ArrayBuffer,
  lpgCsv: Buffer | ArrayBuffer,
  expectedDateYyyymmdd: string,
): ValidatedPriceCsvDownload {
  if (!/^\d{8}$/.test(expectedDateYyyymmdd)) {
    throw new Error(`요청일 형식이 올바르지 않습니다: ${expectedDateYyyymmdd} (YYYYMMDD 필요)`);
  }

  const parsed = parsePriceCsvPair(decodeEucKr(oilCsv), decodeEucKr(lpgCsv));
  const archiveDate = parsed.pricedOn.replace(/-/g, "");
  if (archiveDate !== expectedDateYyyymmdd) {
    throw new Error(
      `오피넷 CSV 기준일자가 요청일과 다릅니다: 요청=${expectedDateYyyymmdd}, 실제=${archiveDate} — Blob 업로드를 중단합니다`,
    );
  }

  return {
    pricedOn: parsed.pricedOn,
    archiveDate,
    oilRows: parsed.oil.rows.length,
    lpgRows: parsed.lpg.rows.length,
  };
}
