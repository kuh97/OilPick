import { describe, expect, it } from "vitest";
import { kstYesterday } from "../download";

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
