import { describe, expect, it } from "vitest";
import { parseNetFunnelKey } from "../download";

describe("parseNetFunnelKey", () => {
  it("5002 bypass — 대기 없음, key 비어도 waiting=false", () => {
    const body = "NetFunnel.gControl.result='5002:200:';NetFunnel.gControl._showResult();";
    expect(parseNetFunnelKey(body)).toEqual({ key: "", waiting: false });
  });

  it("5001 발급 완료 — key를 뽑고 waiting=false", () => {
    const body =
      "NetFunnel.gControl.result='5001:200:key=1A2B3C4D&ip=1.2.3.4&ttl=600&nnp=8080';";
    expect(parseNetFunnelKey(body)).toEqual({ key: "1A2B3C4D", waiting: false });
  });

  it("대기열 상태(5101 + key) — waiting=true", () => {
    const body =
      "NetFunnel.gControl.result='5101:200:key=QUEUEKEY&nwait=42&tid=abc&nnp=8080';";
    expect(parseNetFunnelKey(body)).toEqual({ key: "QUEUEKEY", waiting: true });
  });

  it("URL 인코딩된 key를 디코딩한다", () => {
    const body = "NetFunnel.gControl.result='5001:200:key=aa%2Bbb%3Dcc&ttl=1';";
    expect(parseNetFunnelKey(body).key).toBe("aa+bb=cc");
  });
});
