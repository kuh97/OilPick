import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ list: listMock, put: putMock }));
vi.mock("@/infra/env", () => ({
  env: { BLOB_READ_WRITE_TOKEN: "test-token" },
}));

import { getLatestPriceCsvs, putPriceCsvs } from "../price-csv";

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

  it("latest와 archive 업로드의 공개 CDN 캐시 수명을 60초로 제한한다", async () => {
    const oil = Buffer.from("oil");
    const lpg = Buffer.from("lpg");

    await putPriceCsvs(oil, lpg, "20261020");

    expect(putMock).toHaveBeenCalledTimes(4);
    for (const [, , options] of putMock.mock.calls) {
      expect(options).toEqual(expect.objectContaining({
        cacheControlMaxAge: 60,
        allowOverwrite: true,
      }));
    }
  });
});
