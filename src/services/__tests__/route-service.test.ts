import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/msw/server";
import { getRoute, type RedisLike } from "../route-service";
import { wgs84 } from "@/domain/types";
import directionsFixture from "../../../tests/fixtures/kakao-directions.json";
import directionsWaypointFixture from "../../../tests/fixtures/kakao-directions-waypoint.json";

vi.stubEnv("KAKAO_REST_API_KEY", "test-kakao-key");
vi.stubEnv("KAKAO_MOBILITY_BASE_URL", "https://apis-navi.kakaomobility.com");
vi.stubEnv("REDIS_KEY_PREFIX", "test");

const ORIGIN = wgs84(37.42, 127.12);
const DESTINATION = wgs84(37.88, 127.73);

function fakeRedis(): RedisLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async incrby() {
      return 0;
    },
    async expire() {
      return 1;
    },
  };
}

describe("getRoute — 캐시 미스", () => {
  it("카카오 길찾기를 호출해 BaseRoute를 반환한다", async () => {
    const redis = fakeRedis();
    const route = await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(route.distanceM).toBe(directionsFixture.routes[0].summary.distance);
    expect(route.durationS).toBe(directionsFixture.routes[0].summary.duration);
    expect(route.polyline.length).toBeGreaterThan(0);
  });

  it("응답을 캐시에 저장한다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(redis.store.size).toBe(1);
  });
});

describe("getRoute — 캐시 히트", () => {
  it("캐시에 값이 있으면 카카오를 호출하지 않는다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, redis }); // 캐시 채우기

    server.use(
      http.get("https://apis-navi.kakaomobility.com/v1/directions", () => {
        throw new Error("호출되면 안 됨 — 캐시 히트 기대");
      }),
    );

    const route = await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(route.distanceM).toBe(directionsFixture.routes[0].summary.distance);
  });

  it("역직렬화된 polyline은 WGS84Point 브랜드를 갖는다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    const route = await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(route.polyline[0]._brand).toBe("WGS84");
  });

  it("tollWon도 캐시에 왕복한다 — 직렬화 화이트리스트에서 빠뜨리기 쉽다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    const route = await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(route.tollWon).toBe(directionsFixture.routes[0].summary.fare?.toll);
  });
});

describe("getRoute — 경유지(waypoint)", () => {
  it("waypoint가 있으면 경유 경로 픽스처를 받고, 기본 경로와 다른 캐시 키를 쓴다", async () => {
    const redis = fakeRedis();
    const waypoint = wgs84(37.6, 127.4);
    const route = await getRoute({
      origin: ORIGIN,
      destination: DESTINATION,
      waypoint,
      retries: 0,
      redis,
    });
    expect(route.distanceM).toBe(directionsWaypointFixture.routes[0].summary.distance);

    // 기본 경로도 별도로 캐시됨 (키가 다름)
    await getRoute({ origin: ORIGIN, destination: DESTINATION, redis });
    expect(redis.store.size).toBe(2);
  });
});

describe("getRoute — 경유지 캐시 키 충돌 (회귀)", () => {
  // 실측 버그(2026-08-31): 경유지에도 반경검색용 2km 격자를 그대로 쓰는 바람에
  // 같은 격자 안의 서로 다른 주유소가 캐시를 공유해 남의 경유 경로를 받았다.
  // 아래 두 좌표는 실제로 같은 2km 격자(970000_1936000)에 들어가던 실 데이터다.
  const 대성산업 = wgs84(37.431590173618424, 127.1562265990674);
  const 에코충전소 = wgs84(37.422626688789045, 127.16671783103948);

  it("2km 격자를 공유하는 두 주유소가 서로 다른 캐시 키를 쓴다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, waypoint: 대성산업, retries: 0, redis });
    await getRoute({ origin: ORIGIN, destination: DESTINATION, waypoint: 에코충전소, retries: 0, redis });

    // 충돌하면 1 — 각자 캐시되어야 하므로 2
    expect(redis.store.size).toBe(2);
  });

  it("같은 주유소를 다시 조회하면 캐시를 재사용한다", async () => {
    const redis = fakeRedis();
    await getRoute({ origin: ORIGIN, destination: DESTINATION, waypoint: 대성산업, retries: 0, redis });

    server.use(
      http.get("https://apis-navi.kakaomobility.com/v1/directions", () => {
        throw new Error("호출되면 안 됨 — 캐시 히트 기대");
      }),
    );

    const route = await getRoute({
      origin: ORIGIN,
      destination: DESTINATION,
      waypoint: 대성산업,
      retries: 0,
      redis,
    });
    expect(route.distanceM).toBe(directionsWaypointFixture.routes[0].summary.distance);
    expect(redis.store.size).toBe(1);
  });
});

describe("getRoute — 실패", () => {
  it("카카오 호출이 실패하면 그대로 throw한다", async () => {
    const redis = fakeRedis();
    server.use(
      http.get("https://apis-navi.kakaomobility.com/v1/directions", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(
      getRoute({ origin: ORIGIN, destination: DESTINATION, retries: 0, redis }),
    ).rejects.toThrow();
  });
});
