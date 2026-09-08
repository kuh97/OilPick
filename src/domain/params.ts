/**
 * 튜닝 파라미터 단일 출처 — 값의 정본은 docs/PRODUCT.md §9
 * 이 파일 밖에서 매직 넘버를 쓰지 마십시오.
 * 값을 바꾸려면 PRODUCT.md §9를 먼저 갱신하십시오.
 */

// ─── 티어 분류 (§6.3) ───────────────────────────────────────────────────────
export const T1_MAX = 500;       // m — 경로상 (바로 진입 가능)
export const T2_MAX = 3_000;     // m — 근처 (조금 벗어남)
export const T3_MAX = 15_000;    // m — 우회 탐색 상한 (회랑 bbox 마진)

// ─── 기준가 (§6.5) ─────────────────────────────────────────────────────────
export const P_REF_MIN_BASE = 2;  // 개 — 중앙값 사용 최소 T1+T2 수 (미만이면 시군구 가중평균)

// ─── 우회 추정 (§6.4) ────────────────────────────────────────────────────────
export const DETOUR_ESTIMATE_FACTOR = 2.0;  // ΔD̂ = factor × d_perp (Phase 5 실측으로 유지 — 중앙값 0.67~2.11, PRODUCT.md §9.1)
export const DETOUR_CAP_RATIO = 0.5;        // 우회가 D_base 이 비율 초과 시 제외
export const AVG_SPEED = 50;               // km/h — 우회 시간 ↔ 거리 환산용

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
