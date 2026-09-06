/**
 * 서버 환경변수 접근 단일 창구.
 * infra/ 내부에서만 import합니다. domain/에서는 import 금지.
 */

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`환경변수 ${key}가 설정되지 않았습니다.`);
  return v;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const env = {
  get OPINET_CERT_KEY() { return required("OPINET_CERT_KEY"); },
  get OPINET_BASE_URL() { return optional("OPINET_BASE_URL", "https://www.opinet.co.kr/api"); },
  get OPINET_CONCURRENCY() { return Number(optional("OPINET_CONCURRENCY", "8")); },
  get UPSTASH_REDIS_REST_URL() { return required("UPSTASH_REDIS_REST_URL"); },
  get UPSTASH_REDIS_REST_TOKEN() { return required("UPSTASH_REDIS_REST_TOKEN"); },
  get REDIS_KEY_PREFIX() { return optional("REDIS_KEY_PREFIX", "dev"); },
  get CACHE_BYPASS() { return optional("CACHE_BYPASS", "false") === "true"; },
  get KAKAO_REST_API_KEY() { return required("KAKAO_REST_API_KEY"); },
  get KAKAO_MOBILITY_BASE_URL() { return optional("KAKAO_MOBILITY_BASE_URL", "https://apis-navi.kakaomobility.com"); },
  get KAKAO_LOCAL_BASE_URL() { return optional("KAKAO_LOCAL_BASE_URL", "https://dapi.kakao.com"); },
  get DATABASE_URL() { return required("DATABASE_URL"); },
  get CRON_SECRET() { return required("CRON_SECRET"); },
  // Vercel Blob — 일일 CSV 임포트(Phase D). GitHub Actions가 쓰고 Cron이 읽는다.
  get BLOB_READ_WRITE_TOKEN() { return required("BLOB_READ_WRITE_TOKEN"); },
};
