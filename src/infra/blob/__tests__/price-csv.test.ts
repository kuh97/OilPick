import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ list: listMock, put: putMock }));
vi.mock("@/infra/env", () => ({
  env: { BLOB_READ_WRITE_TOKEN: "test-token" },
}));

import { getArchivedPriceCsvs, getLatestPriceCsvs, putPriceCsvs } from "../price-csv";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  listMock.mockResolvedValue({
    blobs: [
      { pathname: "opinet/latest/oil.csv", url: "https://blob.test/oil.csv" },
      { pathname: "opinet/latest/lpg.csv", url: "https://blob.test/lpg.csv" },
    ],
  });
  fetchMock
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
  putMock.mockResolvedValue(undefined);
});

describe("price CSV Blob", () => {
  it("latest Blob URL에 캐시 버스터를 붙여 CDN의 이전 본문을 피한다", async () => {
    const result = await getLatestPriceCsvs("test-run");

    expect(result.oil).toEqual(Buffer.from([1, 2, 3]));
    expect(result.lpg).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("oilpick_cache_bust")).toBe("test-run");
      expect(init).toEqual(expect.objectContaining({ cache: "no-store" }));
    }
  });

  it("지정 기준일의 불변 archive CSV를 읽는다", async () => {
    listMock.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      blobs: [
        prefix.startsWith("opinet/archive/oil-")
          ? { pathname: "opinet/archive/oil-20261102.csv", url: "https://blob.test/archive-oil.csv" }
          : { pathname: "opinet/archive/lpg-20261102.csv", url: "https://blob.test/archive-lpg.csv" },
      ],
    }));
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6])))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9])));

    const result = await getArchivedPriceCsvs("20261102", "archive-test");

    expect(result.oil).toEqual(Buffer.from([4, 5, 6]));
    expect(result.lpg).toEqual(Buffer.from([7, 8, 9]));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({
      prefix: "opinet/archive/oil-20261102.csv",
    }));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({
      prefix: "opinet/archive/lpg-20261102.csv",
    }));
    for (const [input] of fetchMock.mock.calls) {
      expect(new URL(String(input)).searchParams.get("oilpick_cache_bust")).toBe("archive-test");
    }
  });

  it("archive 기준일 형식이 잘못되면 Blob을 조회하지 않는다", async () => {
    await expect(getArchivedPriceCsvs("2026-11-02")).rejects.toThrow("YYYYMMDD");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("latest와 archive 업로드의 공개 CDN 캐시 수명을 60초로 제한한다", async () => {
    const oil = Buffer.from("oil");
    const lpg = Buffer.from("lpg");

    await putPriceCsvs(oil, lpg, "20261020");

    expect(putMock).toHaveBeenCalledTimes(4);
    expect(putMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "opinet/latest/oil.csv",
      "opinet/latest/lpg.csv",
      "opinet/archive/oil-20261020.csv",
      "opinet/archive/lpg-20261020.csv",
    ]);
    for (const [, , options] of putMock.mock.calls) {
      expect(options).toEqual(expect.objectContaining({
        cacheControlMaxAge: 60,
        allowOverwrite: true,
      }));
    }
  });
});
