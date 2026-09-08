/**
 * 도메인 핵심 타입 — 좌표 3종은 서로 대입 불가한 브랜드 타입
 * AGENTS.md §7.3: 좌표계 혼동이 이 프로젝트의 1순위 버그 원천
 */

// ─── 좌표 브랜드 타입 (§7.3) ─────────────────────────────────────────────────

/** WGS84 십진수 위경도 — 카카오 API 입출력, Neon DB 저장 */
export type WGS84Point = {
  readonly _brand: "WGS84";
  lat: number;  // 위도 (°)
  lng: number;  // 경도 (°)
};

/** 오피넷 KATEC(TM128) 투영좌표 — 오피넷 반경검색 입력 */
export type KatecPoint = {
  readonly _brand: "Katec";
  x: number;  // m
  y: number;  // m
};

/** EPSG:5179 투영좌표 — 거리 계산 전용 */
export type ProjectedPoint = {
  readonly _brand: "Projected";
  x: number;  // m
  y: number;  // m
};

export function wgs84(lat: number, lng: number): WGS84Point {
  return { _brand: "WGS84", lat, lng };
}
export function katec(x: number, y: number): KatecPoint {
  return { _brand: "Katec", x, y };
}
export function projected(x: number, y: number): ProjectedPoint {
  return { _brand: "Projected", x, y };
}

// ─── 연료 · 티어 (§6.3) ──────────────────────────────────────────────────────

export type Fuel = "GASOLINE" | "DIESEL" | "LPG";
export type Tier = "T1" | "T2" | "T3";
export type Facility = "CAR_WASH" | "MAINTENANCE" | "CVS";
export type Mode = "balanced" | "minCost" | "minDistance";
export type RefPriceSource = "MEDIAN_T1T2" | "SIGUNGU_AVG";

// ─── 주유소 마스터 (§7.1) ────────────────────────────────────────────────────

export type EnergyType = "OIL" | "LPG" | "BOTH";
export type BrandCode = string;  // POLL_DIV_CD

// 오피넷 POLL_DIV_CD ↔ 표시명 — PRODUCT.md §5.2 매핑표.
const BRAND_NAME: Record<string, string> = {
  SKE: "SK에너지",
  GSC: "GS칼텍스",
  HDO: "현대오일뱅크",
  SOL: "S-OIL",
  RTO: "자영알뜰",
  RTX: "고속도로알뜰",
  NHO: "농협알뜰",
  ETC: "자가상표",
  E1G: "E1",
  SKG: "SK가스",
};

export function brandName(code: BrandCode): string {
  return BRAND_NAME[code] ?? code;
}

export interface RefuelPoint {
  id: string;               // 오피넷 UNI_ID
  name: string;
  brandCode: BrandCode;
  energyType: EnergyType;
  location: WGS84Point;
  katecLocation?: KatecPoint;
  addressRoad?: string;
  addressJibun?: string;
  tel?: string;
  sigunCd?: string;
  facilities: {
    carWash: boolean;
    maintenance: boolean;
    cvs: boolean;
  };
  isKpetro: boolean;
  isSelf?: boolean;         // 유가 CSV 셀프여부. undefined=미상(상세 API로만 채워진 행 등)
}

// ─── 후보 (검색 결과 계산 중간) ──────────────────────────────────────────────

export interface Candidate {
  station: RefuelPoint;
  price: number;           // 원/L (정수)
  dPerp: number;           // m — 경로 폴리라인 최단거리
  tier: Tier;
  detour: DetourInfo;
  netSaving: number;       // 원 (정수, 음수 가능)
  totalCost: number;       // 원 (정수)
  scores: Scores;
  reason: string;          // domain/reason.ts 생성 문구
  priceUpdatedAt?: Date;   // 오피넷 갱신 스케줄 기반 근사
}

export interface DetourInfo {
  precise: boolean;
  distanceM: number;  // ΔD (m, 정수, ≥0 clamp 후)
  durationS: number;  // ΔT (s, 정수, ≥0 clamp 후)
  /**
   * 이 우회로 추가되는 통행료(원, ≥0 clamp) — 경유 경로 fare.toll − 기본 경로
   * fare.toll. precise===false(실측 안 함)거나 toll 정보가 없으면 undefined.
   * 순수 정보 표시용이다 — netSaving·점수·정렬 어디에도 반영하지 않는다
   * (2026-09-08, 사용자 판단: "100% 정확한 것도 아니라서 순이득엔 안 섞는 게 낫다").
   */
  tollWon?: number;
}

export interface Scores {
  minCost: number;       // 순위 점수
  minDistance: number;   // 순위 점수
  balanced: number;      // 순위 점수 (시간 가치 포함)
}

// ─── 검색 결과 ───────────────────────────────────────────────────────────────

export interface BaseRoute {
  distanceM: number;   // D_base (m)
  durationS: number;   // T_base (s)
  /** 통행료(원) — 카카오 summary.fare.toll. optional인 이유는 DetourInfo.tollWon 참고. */
  tollWon?: number;
  polyline: WGS84Point[];
}

/** ARCHITECTURE.md §6.1 Warning */
export type WarningCode = "TIMEOUT" | "SHORT_ROUTE" | "NO_REFERENCE_PRICE";

export interface Warning {
  code: WarningCode;
  message: string;
}

export interface ExpansionInfo {
  triggered: boolean;    // 최종 목록에 T3(d_perp > T2_MAX)가 남았는가
  finalRadiusM: number;  // 최종 목록에 남은 T3의 최대 d_perp (없으면 T2_MAX)
}

export interface SearchResult {
  searchId: string;   // 익명. 딥링크 이벤트 연결용
  baseRoute: BaseRoute;
  candidates: Candidate[];
  referencePrice: number | null;       // P_ref. A14면 null
  refPriceSource: RefPriceSource | null;
  expansion: ExpansionInfo;
  warnings: Warning[];
}

// ─── 장소 검색 (F1 자동완성) ─────────────────────────────────────────────────

export interface PlaceResult {
  name: string;
  address: string;
  location: WGS84Point;
}

// ─── 입력 ────────────────────────────────────────────────────────────────────

export interface Vehicle {
  fuel: Fuel;
  efficiencyKmPerL: number;  // km/L
  refuelAmountL: number;     // L
  timeValuePerMin: number;   // 원/분
}

export interface SearchInput {
  origin: WGS84Point;
  destination: WGS84Point;
  vehicle: Vehicle;
  filters: {
    facilities: Facility[];
    brands: BrandCode[];
    kpetroOnly: boolean;
    selfOnly: boolean;
  };
  mode: Mode;
  /**
   * 고속도로·자동차전용도로 회피 (카카오 avoid=motorway). 후보 필터가 아니라
   * 경로 자체를 바꾸는 검색 조건이라 filters와 분리했다 — 바뀌면 baseRoute부터
   * 다시 조회해야 한다 (PRODUCT.md §5.1).
   */
  avoidHighway: boolean;
}
