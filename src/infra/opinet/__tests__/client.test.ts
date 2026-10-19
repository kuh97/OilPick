import { describe, expect, it, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw/server";
import {
  fetchRadius,
  fetchDetail,
  fetchAreaCodes,
  fetchAvgSigunPrice,
  createSemaphore,
  setSemaphore,
} from "../client";
import { katec } from "@/domain/types";
import radiusFixture from "../../../../tests/fixtures/opinet-radius.json";
import detailFixture from "../../../../tests/fixtures/opinet-detail.json";
import areaCodeFixture from "../../../../tests/fixtures/opinet-area-code.json";
import avgSigunPriceFixture from "../../../../tests/fixtures/opinet-avg-sigun-price.json";

// MSW 핸들러가 tests/setup.ts에서 이미 설정됨
// env.OPINET_CERT_KEY가 필요하므로 설정
vi.stubEnv("OPINET_CERT_KEY", "test-cert-key");
vi.stubEnv("OPINET_BASE_URL", "https://www.opinet.co.kr/api");
vi.stubEnv("OPINET_CONCURRENCY", "2");

const CENTER = katec(314_871, 544_012);

beforeEach(() => {
  // 각 테스트마다 세마포어 초기화 (동시성 제한 테스트를 위해)
  setSemaphore(createSemaphore(2));
});

describe("fetchRadius", () => {
  it("MSW 픽스처 응답을 파싱해 OIL 배열을 반환한다", async () => {
    const items = await fetchRadius({ center: CENTER, fuel: "GASOLINE" });
    expect(items.length).toBeGreaterThan(0);
    expect(typeof items[0].UNI_ID).toBe("string");
    expect(typeof items[0].PRICE).toBe("number");
  });

  it("픽스처의 첫 번째 항목과 일치한다", async () => {
    const items = await fetchRadius({ center: CENTER, fuel: "GASOLINE" });
    expect(items[0].UNI_ID).toBe(radiusFixture.RESULT.OIL[0].UNI_ID);
  });

  it("잘못된 응답(JSON 파싱 오류) → 에러 throw", async () => {
    server.use(
      http.get("https://www.opinet.co.kr/api/aroundAll.do", () => {
        return HttpResponse.json({ WRONG_KEY: [] });
      }),
    );
    await expect(fetchRadius({ center: CENTER, fuel: "GASOLINE" })).rejects.toThrow();
  });

  it("HTTP 오류 → 재시도 후 에러 throw", async () => {
    server.use(
      http.get("https://www.opinet.co.kr/api/aroundAll.do", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(
      fetchRadius({ center: CENTER, fuel: "GASOLINE", retries: 0 }),
    ).rejects.toThrow();
  });
});

describe("fetchDetail", () => {
  it("MSW 픽스처 응답을 파싱해 상세 항목을 반환한다", async () => {
    const item = await fetchDetail({ uniId: "A0009916" });
    expect(item).not.toBeNull();
    expect(item!.UNI_ID).toBe(detailFixture.RESULT.OIL[0].UNI_ID);
  });

  it("빈 OIL 배열 응답 → null 반환", async () => {
    server.use(
      http.get("https://www.opinet.co.kr/api/detailById.do", () => {
        return HttpResponse.json({ RESULT: { OIL: [] } });
      }),
    );
    const item = await fetchDetail({ uniId: "UNKNOWN" });
    expect(item).toBeNull();
  });
});

describe("fetchAreaCodes", () => {
  it("MSW 픽스처 응답을 파싱해 시도코드 배열을 반환한다", async () => {
    const items = await fetchAreaCodes();
    expect(items.length).toBe(areaCodeFixture.RESULT.OIL.length);
    expect(items[0].AREA_CD).toBe(areaCodeFixture.RESULT.OIL[0].AREA_CD);
  });

  it("잘못된 응답 → 에러 throw", async () => {
    server.use(
      http.get("https://www.opinet.co.kr/api/areaCode.do", () => {
        return HttpResponse.json({ WRONG_KEY: [] });
      }),
    );
    await expect(fetchAreaCodes()).rejects.toThrow();
  });
});

describe("fetchAvgSigunPrice", () => {
  it("MSW 픽스처 응답을 파싱해 시군구 평균가 배열을 반환한다", async () => {
    const items = await fetchAvgSigunPrice({ sido: "01" });
    expect(items.length).toBe(avgSigunPriceFixture.RESULT.OIL.length);
    expect(items[0].SIGUNCD).toBe(avgSigunPriceFixture.RESULT.OIL[0].SIGUNCD);
  });

  it("잘못된 응답 → 에러 throw", async () => {
    server.use(
      http.get("https://www.opinet.co.kr/api/avgSigunPrice.do", () => {
        return HttpResponse.json({ WRONG_KEY: [] });
      }),
    );
    await expect(fetchAvgSigunPrice({ sido: "01" })).rejects.toThrow();
  });
});

describe("createSemaphore — 동시성 제한", () => {
  it("limit=1이면 순차 실행", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];

    await Promise.all([
      sem.run(async () => { order.push(1); await Promise.resolve(); order.push(2); }),
      sem.run(async () => { order.push(3); }),
    ]);

    // limit=1이므로 1,2가 완전히 끝난 뒤 3 시작
    expect(order).toEqual([1, 2, 3]);
  });

  it("동시 실행 수가 limit를 초과하지 않는다", async () => {
    const sem = createSemaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 6 }, () =>
      sem.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
      }),
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("limit가 0이어도 작업을 영원히 대기시키지 않는다", async () => {
    const sem = createSemaphore(0);
    await expect(sem.run(async () => "started")).resolves.toBe("started");
  });
});
