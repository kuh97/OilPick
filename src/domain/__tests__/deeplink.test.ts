import { describe, expect, it } from "vitest";
import {
  buildDeeplink,
  buildWebFallbackUrl,
} from "../deeplink";
import { wgs84 } from "../types";

const ORIGIN = wgs84(37.5, 127.0);
const DEST = wgs84(35.1, 129.0);
const WP = wgs84(36.3, 128.0);

const BASE = {
  origin: ORIGIN,
  destination: DEST,
  waypoint: WP,
  originName: "출발지",
  destinationName: "목적지",
  waypointName: "경유주유소",
  appName: "com.example.oilpick",
};

describe("buildDeeplink — 카카오", () => {
  it("스킴이 kakaomap:// 으로 시작", () => {
    const url = buildDeeplink({ ...BASE, app: "KAKAO" });
    expect(url).toMatch(/^kakaomap:\/\/route/);
  });

  it("출발(sp), 목적(ep), 경유(vp), by=car 포함", () => {
    const url = buildDeeplink({ ...BASE, app: "KAKAO" });
    expect(url).toContain("sp=37.5%2C127");
    expect(url).toContain("ep=35.1%2C129");
    expect(url).toContain("vp=36.3%2C128");
    expect(url).toContain("by=car");
  });

  it("스냅샷 고정", () => {
    const url = buildDeeplink({ ...BASE, app: "KAKAO" });
    expect(url).toMatchInlineSnapshot(
      `"kakaomap://route?sp=37.5%2C127&ep=35.1%2C129&by=car&vp=36.3%2C128"`,
    );
  });
});

describe("buildDeeplink — 네이버", () => {
  it("스킴이 nmap:// 으로 시작", () => {
    const url = buildDeeplink({ ...BASE, app: "NAVER" });
    expect(url).toMatch(/^nmap:\/\/route\/car/);
  });

  it("slat/slng/dlat/dlng/v1lat/v1lng/appname 포함", () => {
    const url = buildDeeplink({ ...BASE, app: "NAVER" });
    expect(url).toContain("slat=37.5");
    expect(url).toContain("dlat=35.1");
    expect(url).toContain("v1lat=36.3");
    expect(url).toContain("appname=com.example.oilpick");
  });
});

describe("buildDeeplink — 티맵", () => {
  it("스킴이 tmap:// 으로 시작", () => {
    const url = buildDeeplink({ ...BASE, app: "TMAP" });
    expect(url).toMatch(/^tmap:\/\/route/);
  });

  it("주유소 좌표(rGoX/rGoY)와 이름(rGoName)을 목적지로 전달 (PRODUCT.md §5.5)", () => {
    const url = buildDeeplink({ ...BASE, app: "TMAP" });
    expect(url).toContain(`rGoX=${WP.lng}`); // lng
    expect(url).toContain(`rGoY=${WP.lat}`); // lat
    expect(url).toContain(`rGoName=${encodeURIComponent("경유주유소")}`);
  });

  it("최종 목적지를 전달하지 않는다 — 티맵은 주유소까지만 안내", () => {
    const url = buildDeeplink({ ...BASE, app: "TMAP" });
    expect(url).not.toContain(`rGoX=${DEST.lng}`);
    expect(url).not.toContain(`rGoY=${DEST.lat}`);
    expect(url).not.toContain(encodeURIComponent("목적지"));
  });

  it("경유지·출발지 파라미터 포함하지 않음 (티맵 미지원)", () => {
    const url = buildDeeplink({ ...BASE, app: "TMAP" });
    expect(url).not.toContain("v1");
    expect(url).not.toContain("waypoint");
    expect(url).not.toContain("slat");
  });
});

describe("buildDeeplink — 옵션 파라미터 미지정", () => {
  const MINIMAL = {
    origin: ORIGIN,
    destination: DEST,
    waypoint: WP,
  };

  it("카카오: 이름 없이도 동작", () => {
    const url = buildDeeplink({ ...MINIMAL, app: "KAKAO" });
    expect(url).toMatch(/^kakaomap:\/\/route/);
  });

  it("네이버: 이름·appName 없이도 동작 (sname 빈 문자열)", () => {
    const url = buildDeeplink({ ...MINIMAL, app: "NAVER" });
    expect(url).toContain("sname=");
    expect(url).toContain("appname=");
  });

  it("티맵: waypointName 없이도 동작 (rGoName 빈 문자열)", () => {
    const url = buildDeeplink({ ...MINIMAL, app: "TMAP" });
    expect(url).toContain("rGoName=");
  });
});

describe("buildWebFallbackUrl — 카카오", () => {
  it("공식 웹 길찾기 포맷(/link/by/car)을 쓴다", () => {
    const url = buildWebFallbackUrl({ ...BASE, app: "KAKAO" });
    expect(url).toMatch(/^https:\/\/map\.kakao\.com\/link\/by\/car\//);
  });

  it("출발 → 경유 → 도착 순서로 3개 지점을 모두 담는다", () => {
    const url = buildWebFallbackUrl({ ...BASE, app: "KAKAO" })!;
    const stops = url.replace("https://map.kakao.com/link/by/car/", "").split("/");
    expect(stops).toHaveLength(3);
    expect(stops[0]).toBe(`${encodeURIComponent("출발지")},${ORIGIN.lat},${ORIGIN.lng}`);
    expect(stops[1]).toBe(`${encodeURIComponent("경유주유소")},${WP.lat},${WP.lng}`);
    expect(stops[2]).toBe(`${encodeURIComponent("목적지")},${DEST.lat},${DEST.lng}`);
  });

  it("스냅샷 고정", () => {
    expect(buildWebFallbackUrl({ ...BASE, app: "KAKAO" })).toMatchInlineSnapshot(
      `"https://map.kakao.com/link/by/car/%EC%B6%9C%EB%B0%9C%EC%A7%80,37.5,127/%EA%B2%BD%EC%9C%A0%EC%A3%BC%EC%9C%A0%EC%86%8C,36.3,128/%EB%AA%A9%EC%A0%81%EC%A7%80,35.1,129"`,
    );
  });
});

describe("buildWebFallbackUrl — 네이버", () => {
  it("New Map 길찾기 포맷(/p/directions/.../car)을 쓴다", () => {
    const url = buildWebFallbackUrl({ ...BASE, app: "NAVER" });
    expect(url).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\//);
    expect(url).toMatch(/\/car$/);
  });

  it("출발 → 도착 → 경유 순서다 (카카오와 다름 — 두 번째 자리가 도착)", () => {
    const url = buildWebFallbackUrl({ ...BASE, app: "NAVER" })!;
    const stops = url
      .replace("https://map.naver.com/p/directions/", "")
      .replace(/\/car$/, "")
      .split("/");
    expect(stops).toHaveLength(3);
    expect(stops[0]).toContain(encodeURIComponent("출발지"));
    expect(stops[1]).toContain(encodeURIComponent("목적지"));
    expect(stops[2]).toContain(encodeURIComponent("경유주유소"));
  });

  it("각 지점은 {x},{y},{name},{poiId},{type} 5필드다", () => {
    const url = buildWebFallbackUrl({ ...BASE, app: "NAVER" })!;
    const stops = url
      .replace("https://map.naver.com/p/directions/", "")
      .replace(/\/car$/, "")
      .split("/");
    for (const stop of stops) {
      const fields = stop.split(",");
      expect(fields).toHaveLength(5);
      expect(fields[3]).toBe(""); // poiId는 비워둔다
      expect(fields[4]).toBe("SIMPLE_POI");
    }
  });

  it("좌표 인코딩이 실제 네이버 링크의 토큰과 일치한다", () => {
    // 실제 map.naver.com이 생성한 링크에서 얻은 검증값 (대성산업(주)성남충전소).
    // 이 인코딩(위경도×1e7 + 20억 → 62진법)이 깨지면 링크가 엉뚱한 좌표를 가리킨다.
    const 대성산업 = wgs84(37.431590173618424, 127.1562265990674);
    const url = buildWebFallbackUrl({
      app: "NAVER",
      origin: ORIGIN,
      destination: DEST,
      waypoint: 대성산업,
      waypointName: "대성산업(주)성남충전소",
    })!;
    const viaStop = url.replace(/\/car$/, "").split("/").pop()!;
    const [x, y] = viaStop.split(",");
    expect(x).toBe("3zp8Nk"); // lng
    expect(y).toBe("2AGo1M"); // lat
  });

  it("스냅샷 고정", () => {
    expect(buildWebFallbackUrl({ ...BASE, app: "NAVER" })).toMatchInlineSnapshot(
      `"https://map.naver.com/p/directions/3ziAnu,2AJfZC,%EC%B6%9C%EB%B0%9C%EC%A7%80,,SIMPLE_POI/3AEvi8,2z6yuQ,%EB%AA%A9%EC%A0%81%EC%A7%80,,SIMPLE_POI/3zYxPO,2zUUfe,%EA%B2%BD%EC%9C%A0%EC%A3%BC%EC%9C%A0%EC%86%8C,,SIMPLE_POI/car"`,
    );
  });
});

describe("buildWebFallbackUrl — 티맵", () => {
  it("웹 길찾기를 제공하지 않으므로 null", () => {
    expect(buildWebFallbackUrl({ ...BASE, app: "TMAP" })).toBeNull();
  });
});

describe("buildWebFallbackUrl — 이름 미지정", () => {
  const MINIMAL = { origin: ORIGIN, destination: DEST, waypoint: WP };

  it("카카오: 기본 이름으로 대체한다", () => {
    const url = buildWebFallbackUrl({ ...MINIMAL, app: "KAKAO" })!;
    expect(url).toContain(encodeURIComponent("출발지"));
    expect(url).toContain(encodeURIComponent("주유소"));
    expect(url).toContain(encodeURIComponent("목적지"));
  });

  it("네이버: 이름 자리가 비지 않는다 (필드 수가 어긋나면 링크가 깨진다)", () => {
    const url = buildWebFallbackUrl({ ...MINIMAL, app: "NAVER" })!;
    const stops = url
      .replace("https://map.naver.com/p/directions/", "")
      .replace(/\/car$/, "")
      .split("/");
    for (const stop of stops) {
      expect(stop.split(",")[2]).not.toBe("");
    }
  });
});
