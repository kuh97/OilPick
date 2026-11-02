import { describe, expect, it } from "vitest";
import { kstYesterday, resolveDownloadDate } from "../download";

// downloadPriceCsv() 자체는 실제 브라우저로 라이브 오피넷을 조작하므로 단위 테스트
// 대상이 아니다 — 검증은 GitHub Actions(.github/workflows/opinet-daily.yml)의
// 실제 실행 또는 `pnpm data:download-csv` 수동 실행으로 한다.

describe("kstYesterday", () => {
  it("KST 자정 직후 → 그 전날 (UTC로는 아직 전전날 15시라도 KST 기준)", () => {
    // 2026-09-06 00:30 KST == 2026-09-05 15:30 UTC
    const now = Date.UTC(2026, 8, 5, 15, 30);
    expect(kstYesterday(now)).toBe("20260905");
  });

  it("KST 낮 → 하루 전", () => {
    // 2026-09-06 12:00 KST == 2026-09-06 03:00 UTC
    const now = Date.UTC(2026, 8, 6, 3, 0);
    expect(kstYesterday(now)).toBe("20260905");
  });

  it("월 경계", () => {
    // 2026-10-01 09:00 KST == 2026-10-01 00:00 UTC
    const now = Date.UTC(2026, 9, 1, 0, 0);
    expect(kstYesterday(now)).toBe("20260930");
  });
});

describe("resolveDownloadDate", () => {
  const now = Date.UTC(2026, 10, 2, 0, 0); // 2026-11-02 09:00 KST

  it("입력하지 않으면 KST 어제로 확정한다", () => {
    expect(resolveDownloadDate(undefined, now)).toBe("20261101");
  });

  it("명시한 유효 날짜는 그대로 사용한다", () => {
    expect(resolveDownloadDate("20261031", now)).toBe("20261031");
  });

  it("형식 오류와 실재하지 않는 날짜를 거부한다", () => {
    expect(() => resolveDownloadDate("2026-11-01", now)).toThrow(/YYYYMMDD/);
    expect(() => resolveDownloadDate("20260230", now)).toThrow(/유효하지/);
  });
});
