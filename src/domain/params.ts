/**
 * 튜닝 파라미터 단일 출처 — 값의 정본은 docs/PRODUCT.md §9
 * 이 파일 밖에서 매직 넘버를 쓰지 마십시오.
 * 값을 바꾸려면 PRODUCT.md §9를 먼저 갱신하십시오.
 */

// ─── 실제 경로상 배지 판정 (§6.4) ───────────────────────────────────────────
// 실제 경로의 ΔT·ΔD가 모두 기준 이내면 🟢경로상, 그 밖은 🟡우회.
export const ON_ROUTE_MAX_S = 180; // s
export const ON_ROUTE_MAX_D = 1_500; // m
// STAGE 1에서 Valhalla 실측을 시작할 DB 사전 범위. 실제 경로상 판정은
// ON_ROUTE_MAX_S·ON_ROUTE_MAX_D로만 한다. STAGE 2에서 선택 거리+3km(최대 T3_MAX)까지 확장한다.
export const ON_ROUTE_PREFILTER_MAX_M = 300; // m

// ─── 티어 분류 (§6.3) ───────────────────────────────────────────────────────
export const T2_MAX = 3_000; // m — P_ref 표본 정의 전용 (§6.4)
export const T3_MAX = 15_000; // m — 우회 탐색 상한 (회랑 bbox 마진)
export const DETOUR_DISTANCE_OPTIONS_KM = [3, 5, 10, 15] as const;
export const DEFAULT_MAX_DETOUR_DISTANCE_KM = 5;
export const DETOUR_SEARCH_BUFFER_M = 3_000; // m — 실제 허용 거리 밖 후보 누락 방지 여유

// ─── 기준가 (§6.5) ─────────────────────────────────────────────────────────
export const P_REF_MIN_BASE = 2; // 개 — 중앙값 사용 최소 표본 수 (미만이면 시군구 가중평균)

// ─── 실제 우회 안전 상한 (§6.4) ──────────────────────────────────────────────
export const DETOUR_CAP_RATIO = 0.5; // 우회가 D_base 이 비율 초과 시 제외
export const DETOUR_TIME_CAP_RATIO = 0.5; // 우회 시간이 T_base 이 비율 초과 시 제외 (Phase 10 실측 — §9.1)
// D_base < MIN_ROUTE_DISTANCE일 때 비율 cap 대신 쓰는 절대 시간 상한 — 비율 cap은
// 짧은 경로에서 수 분으로 수렴해 정당한 우회까지 막지만(Phase 9), 완전히 끄면
// 순절감액>0만으로 30~50분짜리 우회가 그대로 통과한다(Phase 11 실측 —
// PRODUCT.md §10.1 A6).
export const SHORT_ROUTE_DETOUR_TIME_CAP_S = 20 * 60; // 20분

// ΔD_eff(§6.5, 최단거리 모드 점수) 환산 전용.
export const AVG_SPEED = 50; // km/h

// ─── 결과 상한 (§7.2) ───────────────────────────────────────────────────────
export const MAX_RESULTS = 15; // 개 — STAGE 2 우회 후보 화면 최대 수. 경로상 후보는 전부 보존

// ─── 가격 이상치 (§8.2 A4) ──────────────────────────────────────────────────
export const OUTLIER_SIGMA = 3; // σ — 중앙값 ± 이 배수 σ 벗어나면 이상치

// ─── UI (§6.1, §5.3) ────────────────────────────────────────────────────────
export const MIN_ROUTE_DISTANCE = 20_000; // m — 이보다 짧으면 안내 후 진행
export const MIN_OD_GAP = 500; // m — 출발지·목적지 최소 간격

// ─── 자동완성 (§4.1) ────────────────────────────────────────────────────────
export const PLACE_QUERY_MIN_LEN = 2; // 자
export const PLACE_DEBOUNCE_MS = 300; // ms

// ─── 내 주변 (§5.6, §6.4) ───────────────────────────────────────────────────
export const SEARCH_RADIUS = 3_000; // m — 내 주변 검색 반경

// ─── 계산 전제 기본값 (§9.2) — 사용자가 수정 가능 ────────────────────────────
export const DEFAULT_EFFICIENCY: Record<"GASOLINE" | "DIESEL" | "LPG", number> =
  {
    GASOLINE: 12, // km/L  ⚠️ 공식 통계로 보정 필요 (Phase 5 §11.3)
    DIESEL: 14, // km/L
    LPG: 8.5, // km/L
  };

export const DEFAULT_REFUEL_AMOUNT = 45; // L — 일반 승용차 탱크 80% 수준
export const V_TIME = 200; // 원/분 — 균형 모드 시간 가치 (시급 12,000원 기준)

// ─── 검색 단계 Valhalla 실행 ────────────────────────────────────────────────
// 로컬 실측: Valhalla server_threads=4에서 후보 16개 검색이 약 16초로 수렴했다.
// Valhalla 서버의 스레드 수보다 크게 올리지 않는다.
export const VALHALLA_ROUTE_CONCURRENCY = 8;
export const VALHALLA_TIMEOUT_MS = 5_000;
export const VALHALLA_CACHE_TTL_S = 60 * 60;
