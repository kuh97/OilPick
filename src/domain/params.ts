/**
 * 튜닝 파라미터 단일 출처 — 값의 정본은 docs/PRODUCT.md §9
 * 이 파일 밖에서 매직 넘버를 쓰지 마십시오.
 * 값을 바꾸려면 PRODUCT.md §9를 먼저 갱신하십시오.
 */

// ─── 경로상 배지 판정 (§6.4) ─────────────────────────────────────────────────
// 실측 ΔT ≤ ON_ROUTE_MAX_S  AND  ΔD ≤ ON_ROUTE_MAX_D → 🟢경로상, 그 밖 → 🟡우회.
// 실측 아닌 사용자 판단값(2026-09-09).
export const ON_ROUTE_MAX_S = 180;          // s
export const ON_ROUTE_MAX_D = 1_500;        // m
export const ON_ROUTE_PREFILTER_M = 2_500;  // m — STAGE 1 실측 대상 d_perp 상한 (§6.4)

// ─── 티어 분류 (§6.3) ───────────────────────────────────────────────────────
export const T2_MAX = 3_000;     // m — P_ref 표본 정의 전용 (§6.4)
export const T3_MAX = 15_000;    // m — 우회 탐색 상한 (회랑 bbox 마진)

// ─── 기준가 (§6.5) ─────────────────────────────────────────────────────────
export const P_REF_MIN_BASE = 2;  // 개 — 중앙값 사용 최소 표본 수 (미만이면 시군구 가중평균)

// ─── 우회 추정 (§6.4) ────────────────────────────────────────────────────────
export const DETOUR_ESTIMATE_FACTOR = 2.0;  // ΔD̂ = factor × d_perp (Phase 5 실측으로 유지 — 중앙값 0.67~2.11, PRODUCT.md §9.1)
// T3 게이트 전용 계수 — DETOUR_ESTIMATE_FACTOR(점수·정렬용, 보수적)보다 낙관적으로 둔다.
// 게이트에서 잘못 걸리면 복구 불가하지만, 잘못 통과해도 나중에 걸러진다 (§6.5, Phase 12).
export const T3_GATE_DETOUR_FACTOR = 1.0;
export const DETOUR_CAP_RATIO = 0.5;        // 우회가 D_base 이 비율 초과 시 제외
export const DETOUR_TIME_CAP_RATIO = 0.5;   // 우회 시간이 T_base 이 비율 초과 시 제외 (Phase 10 실측 — §9.1)
// D_base < MIN_ROUTE_DISTANCE일 때 비율 cap 대신 쓰는 절대 시간 상한 — 비율 cap은
// 짧은 경로에서 수 분으로 수렴해 정당한 우회까지 막지만(Phase 9), 완전히 끄면
// 순절감액>0(추정 기준)만으로 30~50분짜리 우회가 그대로 통과한다(Phase 11 실측 —
// PRODUCT.md §10.1 A6).
export const SHORT_ROUTE_DETOUR_TIME_CAP_S = 20 * 60;  // 20분

// ΔD_eff(§6.5, 최단거리 모드 점수) 환산 전용. 우회 허용 시간 게이트는 경로 실측
// 평균속도(D_base/T_base)를 쓴다 — §7.2 STEP 7.
export const AVG_SPEED = 50;               // km/h

// 경로 실측 평균속도 클램프 (§7.2 STEP 7).
export const ROUTE_SPEED_MIN_KMH = 10;
export const ROUTE_SPEED_MAX_KMH = 100;

// ─── 정밀 계산 (§7.2 STEP 10) ───────────────────────────────────────────────
export const MAX_PRECISE = 15;  // 개 — 정밀 계산(경유 경로) 개수. MAX_RESULTS와 같게 유지 (§7.2 STEP 10)
export const MAX_RESULTS = 15;  // 개 — 화면 최대 후보 수

// ─── 가격 이상치 (§8.2 A4) ──────────────────────────────────────────────────
export const OUTLIER_SIGMA = 3;  // σ — 중앙값 ± 이 배수 σ 벗어나면 이상치

// ─── UI (§6.1, §5.3) ────────────────────────────────────────────────────────
export const MIN_ROUTE_DISTANCE = 20_000; // m — 이보다 짧으면 안내 후 진행
export const MIN_OD_GAP = 500;           // m — 출발지·목적지 최소 간격

// ─── 자동완성 (§4.1) ────────────────────────────────────────────────────────
export const PLACE_QUERY_MIN_LEN = 2;   // 자
export const PLACE_DEBOUNCE_MS = 300;   // ms

// ─── 내 주변 (§5.6, §6.4) ───────────────────────────────────────────────────
export const SEARCH_RADIUS = 5_000;  // m — 오피넷 aroundAll.do 고정 반경. API 최댓값(고정)

// ─── 계산 전제 기본값 (§9.2) — 사용자가 수정 가능 ────────────────────────────
export const DEFAULT_EFFICIENCY: Record<"GASOLINE" | "DIESEL" | "LPG", number> = {
  GASOLINE: 12,  // km/L  ⚠️ 공식 통계로 보정 필요 (Phase 5 §11.3)
  DIESEL: 14,    // km/L
  LPG: 8.5,      // km/L
};

export const DEFAULT_REFUEL_AMOUNT = 45;  // L — 일반 승용차 탱크 80% 수준
export const V_TIME = 200;                // 원/분 — 균형 모드 시간 가치 (시급 12,000원 기준)

// ─── 필터 기본값 (§5.2) — 사용자가 수정 가능 ─────────────────────────────────
// SHORT_ROUTE_DETOUR_TIME_CAP_S(위)와 값은 같지만 역할이 다르다 — 저건 "이 이상은
// 아예 같은 여정이 아니다"라는 기술적 하한(서버, 조정 불가), 이건 "나는 이 이상은
// 안 돌아간다"는 사용자 취향(클라이언트, 조정 가능) — Phase 11.
export const DEFAULT_MAX_DETOUR_MINUTES = 20;
