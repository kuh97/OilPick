const DEFAULT_SITE_URL = "https://oilpick.vercel.app";

/**
 * 공개 URL의 단일 기준점. 배포 환경에서는 README.md에 정의된 APP_BASE_URL을 쓰고,
 * 로컬 테스트처럼 환경변수가 없는 경우에만 운영 URL로 폴백한다.
 */
export const SITE_URL = new URL(process.env.APP_BASE_URL ?? DEFAULT_SITE_URL);

export const SITE_NAME = "오일픽";
export const SITE_TITLE = "오일픽 | 가는 길 주유소·우회 경로 찾기";
export const SITE_DESCRIPTION =
  "출발지와 목적지를 입력하면 경로상의 주유소를 찾고, 필요하면 우회 거리·시간과 예상 절감액을 비교해 경유 경로까지 안내합니다.";
