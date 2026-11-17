# 오피넷 API → DB 기반 전환 기록

> **상태: 전환 코드 구현 완료** — 마지막 문서 점검 2026-11-17
>
> Phase A~E와 검색 경로 전환은 코드에 반영되었습니다. 실제 운영 배포와 시설 정보 백필 완료 여부는
> 이 저장소만으로 확정할 수 없으므로 `data:backfill-details --status`와 운영 로그로 확인합니다.
>
> 이 문서는 검색 경로의 오피넷 실시간 호출을 **일 1회 CSV 임포트 + DB 조회**로 바꾼
> 배경·검증·적용 순서를 보존하는 완료 기록입니다. 현재 제품·API·DB 계약은
> [`PRODUCT.md`](PRODUCT.md)와 [`ARCHITECTURE.md`](ARCHITECTURE.md)가 소유하며, 이 문서가
> 두 문서를 덮어쓰지 않습니다.
>
> 아래의 “전환 전”·“전환 당시” 수치와 단계는 역사 기록입니다. 현재 검색 알고리즘은
> [`PRODUCT.md`](PRODUCT.md) §6.6과 [`ARCHITECTURE.md`](ARCHITECTURE.md) §9.1을 따릅니다.

---

## 1. 왜 바꾸는가

전환 전 [`ARCHITECTURE.md`](ARCHITECTURE.md) §5.3.1에서 확인했던 제약은 다음과 같습니다.

```
오피넷 일일 한도 300회 (OPINET_DAILY_BUDGET=280)
  확장 없음 : 검색당 13회 → 하루 약 23건
  확장 발동 : 검색당 39회 → 하루 약 7~8건
```

§5.3.1이 지적한 대로 **확장이 가장 자주 발동하는 세그먼트가 1순위 타깃(LPG 장거리)** 이라,
핵심 사용자일수록 예산을 3배 더 씁니다. 하루 7~8명이면 예산이 소진됩니다.

§5.3.1 표의 옵션 **D "배치 사전 수집 — 채택 안 함"** 을 뒤집습니다.
당시 기각 사유는 *"초기엔 인기 경로를 알 수 없어 효과가 제한적"* 이었는데,
경로별 사전 수집이 아니라 **전국 전수 스냅샷**이면 이 논리가 성립하지 않습니다.

### 1.1 판을 바꾼 것 — 유가 CSV의 `번호` 컬럼이 `UNI_ID`다

오피넷 "과거 판매가격" CSV의 `번호` 컬럼이 오피넷 `UNI_ID`와 **동일**합니다.
2026-09-04자 파일로 실측 확인했습니다.

```
DB의 energy_type='OIL' 879건 → 주유소 CSV와 879건 조인 (100.0%)
DB 주소 vs CSV 주소 문자 단위 완전일치 : 1,127 / 1,130
```

주소가 쉼표 위치까지 일치합니다 — 이 CSV는 오피넷 API와 **동일 원본의 벌크 덤프**입니다.
별도 매칭 로직 없이 `refuel_point.id`에 직접 조인됩니다.

> [`ARCHITECTURE.md`](ARCHITECTURE.md) §7.1의 "폴백 C — 표준데이터 포기" 판단은 **지금도 유효**합니다.
> 판을 바꾼 것은 행안부 표준데이터가 아니라 이 가격 CSV입니다 (§3.4 참고).

---

## 2. 전환 전 / 후

| 항목 | 현재 | 전환 후 |
| --- | --- | --- |
| 검색 1건당 오피넷 호출 | 13회 (확장 시 39회) | **0회** |
| 하루 가능 검색 수 | 약 7~23건 | **무제한** |
| 일 배치 오피넷 호출 | 17회 (시군구 평균가) | 0회 (백필 완료 후) |
| 카카오 경로 호출 | 검색당 ≤7회 | 변화 없음 |
| 후보 수집 방식 | 8km 간격 샘플점 × 5km 반경 원 | 폴리라인 회랑 DB 쿼리 |
| 후보 누락 | 원 사이 빈틈 + T3(15km) 바깥 | **0** |
| 수집 소요 | 수 초 (타임아웃 4s, 동시성 8) | 수십 ms |
| 가격 기준시각 | 갱신 스케줄에서 추정 | 실제 기준일자 |
| 마스터 커버리지 | 1,207개소 | **11,785개소** |

**작업량 구분 — 34일은 사람이 일하는 기간이 아닙니다.**

```
코드 작업       : 3~5일   ← 사람
백필 크론 완주  : 34일    ← 켜두면 무인으로 도는 것 (§7 Phase E)
```

---

## 3. 데이터 원본 분석 (2026-09-04자 실측)

### 3.1 주유소 CSV — 10,237개소

```
"번호","지역","상호","주소","기간","상표","셀프여부","고급휘발유","휘발유","경유","실내등유"
"기준 : 일간(20260904~20260904)"          ← 2행은 메타행. 반드시 스킵
"A0033584","강원 강릉시","(주)강릉햇살 유천주유소",...,"2230","1809","1789","0"
```

| 항목 | 실측 |
| --- | --- |
| 인코딩 | **EUC-KR** (UTF-8 변환 필요) |
| 행 수 | 10,237 (`UNI_ID` 중복 0건, 형식 `A\d{7}` 100%) |
| 상표 | SK에너지 2,549 / S-OIL 2,197 / HD현대오일뱅크 2,169 / GS칼텍스 1,913 / NH-OIL 716 / 알뜰주유소 380 / 알뜰(ex) 204 / 자가상표 109 |
| 셀프여부 | 셀프 6,268 / 일반 3,969 |
| 지역 | 시도 16개 · 시군구 230개 |
| 휘발유 | 유효 10,186건 (1,659 ~ 2,549원) |
| 경유 | 유효 10,227건 (1,735 ~ 2,539원) |
| 고급휘발유 | 유효 2,010건 (2,080 ~ 2,970원) |
| 실내등유 | 유효 4,831건 (1,300 ~ 2,000원) |

**`0`은 무료가 아니라 "미취급"입니다.** 기존 A3 규칙(`price <= 0` 제외)과 동일하게 처리합니다.

### 3.2 충전소 CSV — 1,807개소

LPG 단일 컬럼, 949 ~ 1,390원, 0원 없음.
주유소 CSV와 **259개 ID가 겹칩니다** (= 주유소 겸업 충전소).

```
합집합 = 11,785개소
```

### 3.3 코드 환원 — 실측 대조표

DB에 쌓인 1,207건으로 대조한 결과입니다. 임포터의 매핑 테이블 근거로 쓰십시오.

| `POLL_DIV_CD` | CSV `상표` | 대조 건수 |
| --- | --- | --- |
| `SKE` | SK에너지 | 272 |
| `GSC` | GS칼텍스 | 228 |
| `SOL` | S-OIL | 222 |
| `HDO` | HD현대오일뱅크 | 218 |
| `SKG` | SK가스 | 70 |
| `E1G` | E1 | 44 |
| `NHO` | NH-OIL | 30 |
| `RTO` | 알뜰주유소 | 26 |
| `RTX` | 알뜰(ex) | 8 |
| `ETC` | 자가상표 | 10 (+ 예외 2건) |

`ETC`에서 CSV가 "GS칼텍스"·"SK가스"로 표기한 예외가 2건 있습니다. **`POLL_DIV_CD`를 정본으로 삼고**,
CSV `상표`는 신규 주유소의 코드 추정에만 씁니다.

`SIGUNCD` ↔ CSV `지역` 텍스트는 **관측된 70개 코드 전부 1:1** 이며 충돌이 0건입니다.
나머지 160개 시군구 코드는 `areaCode.do`를 `area` 파라미터와 함께 호출해 확보합니다
(1 + 16 = **17회, 1회성**).

### 3.4 CSV에 없는 것

| 없는 항목 | 영향 | 대응 |
| --- | --- | --- |
| **위도·경도** | `d_perp`·티어 분류 전부가 좌표 기반 | 카카오 지오코딩 (§4) |
| 시설정보(세차·정비·편의점) | 시설 필터 판정 불가 | 백그라운드 백필 (§7 Phase E) |
| 품질인증(KPETRO) | `kpetroOnly` 필터 불가 | 동일 |
| 전화번호 | 상세 화면 표시 (경미) | 동일 |
| `SIGUNCD` | `P_ref` 시군구 집계 키 | `지역` 텍스트 → 코드 매핑 (§3.3) |

### 3.5 행안부 표준데이터는 여전히 답이 아니다

`data/전국주유소표준데이터.csv`로 좌표를 조달할 수 있는지 재확인했습니다.

```
표준데이터 5,007행 vs 가격 CSV 10,237행
도로명주소 정규화 매칭 : 3,667 (35.8%)
상호 + 시군구 매칭     : 3,385 (33.1%)
둘 중 하나라도 매칭    : 4,321 (42.2%)
광주광역시 = 0건  ← 자치단체별 제출이라 구조적으로 불완전
```

`UNI_ID`가 없어 정확 조인이 불가능하고, 커버리지도 42%에 그칩니다. **쓰지 않습니다.**

여기서 말하는 표준데이터는 주유소 시설 목록입니다. 별도로 내려받은 ITS **표준 노드·링크
데이터**(`MOCT_NODE`, `MOCT_LINK`, `TURNINFO`)는 주유소 조인용이 아니라 도로 방향
보조 데이터로 사용합니다. 원본에는 주유소 진입구가 없으므로, PostGIS로 가장 가까운
링크의 방향만 비교하고 명백한 반대 방향 후보를 줄이는 데 그칩니다.

---

## 4. 좌표 조달 — 카카오 지오코딩

DB에 이미 있는 오피넷 실좌표를 정답지로 놓고 오차를 측정했습니다.

```
표본 40건 (정답 = 오피넷 GIS_X_COOR / GIS_Y_COOR)

주소검색   : 성공 40/40   중앙값 15m   p90 37m   최대 74m
             50m 이내 39건 · 200m 이내 40건
키워드검색 : 성공 33/40   중앙값 11m   p90 34m   최대 41m
```

**`T1_MAX`가 500m인데 최대 오차가 74m입니다.** 티어 분류에 실질적 영향이 없습니다.

| 항목 | 값 |
| --- | --- |
| 대상 | 11,785 − (오피넷 좌표 보유 1,207) = **10,578건** |
| 카카오 로컬 API 쿼터 | 일 100,000건 → 하루에 전량 처리 가능 |
| 1순위 | `/v2/local/search/address.json` (주소검색) |
| 2순위 | `/v2/local/search/keyword.json` (`{시군구} {상호}`) — 주소검색 실패 시 |
| 실패 시 | 해당 행을 이번 임포트에서 제외하고 `data/csv/geocode-failures.json`에 기록. `refuel_point.lat/lng`는 `NOT NULL` 유지 |

`coord_source` 컬럼에 `OPINET` / `KAKAO_ADDR` / `KAKAO_KEYWORD` 중 하나를 남깁니다.
**오피넷 좌표가 있으면 지오코딩하지 않습니다** (§6 소유권 규칙).

---

## 5. 스키마 변경

### 5.1 `refuel_point` — 컬럼 추가

```sql
ALTER TABLE refuel_point ADD COLUMN is_self        BOOLEAN;      -- CSV 셀프여부. NULL=미상
ALTER TABLE refuel_point ADD COLUMN coord_source   TEXT;         -- OPINET | KAKAO_ADDR | KAKAO_KEYWORD
ALTER TABLE refuel_point ADD COLUMN priced_on      DATE;         -- CSV 기준일자
ALTER TABLE refuel_point ADD COLUMN last_seen_on   DATE;         -- 마지막으로 CSV에 등장한 날
ALTER TABLE refuel_point ADD COLUMN price_gasoline INTEGER;      -- B027
ALTER TABLE refuel_point ADD COLUMN price_diesel   INTEGER;      -- D047
ALTER TABLE refuel_point ADD COLUMN price_lpg      INTEGER;      -- K015
ALTER TABLE refuel_point ADD COLUMN price_premium  INTEGER;      -- B034 (적재만, UI 미노출)
ALTER TABLE refuel_point ADD COLUMN price_kerosene INTEGER;      -- C004 (적재만, UI 미노출)

-- 회랑 쿼리용. 11,785행이면 PostGIS 불필요 — bbox 프리필터로 충분
CREATE INDEX idx_refuel_point_latlng ON refuel_point (lat, lng);
CREATE INDEX idx_refuel_point_seen   ON refuel_point (last_seen_on);
```

`last_price` / `last_price_prod` / `price_traded_at`은 상세 API로만 발견된 레거시 행의 가격
폴백을 위해 현재도 남겨 둡니다. CSV에 포함된 행은 유종별 컬럼과 `priced_on`을 우선 사용합니다.

> **가격 이력 테이블은 만들지 않습니다.** 최신 스냅샷만 덮어씁니다 (§11 결정 ③).

### 5.2 `csv_import_log` — 신규

```sql
CREATE TABLE csv_import_log (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  priced_on   DATE,                    -- 파일에서 파싱한 기준일자
  status      TEXT NOT NULL,           -- 'OK' | 'GATE_FAILED' | 'DOWNLOAD_FAILED'
  failed_gate TEXT,                    -- 'G4' 등
  detail      TEXT,
  oil_rows    INTEGER,
  lpg_rows    INTEGER,
  geocoded    INTEGER
);
```

### 5.3 `sigungu_avg_price` — 테이블 제거 완료

`P_ref` 폴백은 `refuel_point`의 전국 가격에서 직접 집계합니다. 따라서 별도 평균가 테이블과
일 17회 배치는 제거되었습니다.

`findSigunguAvgPrice`·`findSidoAvgPrice`·`findNationalAvgPrice`라는 함수 이름은
`price-service` 호출 계약을 유지하기 위해 남아 있지만, 모두 `refuel_point`를 집계합니다.
`avgSigunPrice.do`는 CSV 임포트 중 지역명→시군구 코드 매핑을 보조할 때만 호출됩니다.

### 5.4 `road_node`·`road_link`·`road_turn` — 방향 필터 보조 데이터

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE road_node (
  node_id TEXT PRIMARY KEY, node_type TEXT NOT NULL, node_name TEXT,
  turn_p TEXT, updated_date DATE, geometry geometry(Point, 5179) NOT NULL
);
CREATE TABLE road_link (
  link_id TEXT PRIMARY KEY, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
  geometry geometry(LineString, 5179) NOT NULL
);
CREATE TABLE road_turn (
  node_id TEXT NOT NULL, turn_id INTEGER NOT NULL,
  start_link TEXT NOT NULL, end_link TEXT NOT NULL,
  PRIMARY KEY (node_id, turn_id)
);
```

원본 SHP/DBF는 저장소에 넣지 않고 `pnpm data:import-nodelink -- <압축 해제 폴더>`로
적재합니다. 임포터는 `ITRF2000_Central_Belt_60`을 EPSG:5179로 변환하고, 전체 적재는
`psql COPY`로 수행합니다. `road_link`의 실제 진입구가 없으므로 링크가 3km 이내에 없거나
판정이 애매한 후보는 검색에서 제거하지 않습니다.

---

## 6. 컬럼 소유권 규칙 ★

**이 표를 어기면 매일 새벽 CSV 임포트가 시설정보를 지웁니다.**
세 소스가 같은 테이블을 쓰므로, 각자 자기 컬럼만 `SET` 절에 넣습니다.

| 컬럼 | 소유자 | CSV 임포트 |
| --- | --- | --- |
| `name` `brand_code` `address_road` `sigun_cd` | CSV | ✅ 덮어씀 |
| `is_self` `priced_on` `last_seen_on` | CSV | ✅ 덮어씀 |
| `price_gasoline` `price_diesel` `price_lpg` `price_premium` `price_kerosene` | CSV | ✅ 덮어씀 |
| `lat` `lng` `coord_source` | 지오코딩 | 신규 행 생성 시 채움. 기존 행의 좌표는 CSV 재임포트로 덮지 않음 |
| `has_car_wash` `has_maintenance` `has_cvs` | detail API | ❌ SET 절에 넣지 않음 |
| `is_kpetro` `tel` `detail_synced_at` | detail API | ❌ SET 절에 넣지 않음 |

```ts
// src/infra/db/repositories.ts — 신규 함수
// upsertRefuelPointFromDetail 과 SET 절이 절대 겹치면 안 됩니다.
export async function bulkUpsertFromCsv(rows: CsvRow[], db: Db = getDb()) {
  await db.insert(refuelPoint).values(rows)
    .onConflictDoUpdate({
      target: refuelPoint.id,
      set: {
        name:       sql`excluded.name`,
        brandCode:  sql`excluded.brand_code`,
        addressRoad: sql`excluded.address_road`,
        sigunCd:    sql`excluded.sigun_cd`,
        isSelf:     sql`excluded.is_self`,
        pricedOn:   sql`excluded.priced_on`,
        lastSeenOn: sql`excluded.last_seen_on`,
        priceGasoline: sql`excluded.price_gasoline`,
        priceDiesel:   sql`excluded.price_diesel`,
        priceLpg:      sql`excluded.price_lpg`,
        // 기존 좌표 우선 — 오피넷 실좌표를 새 지오코딩 값으로 덮지 않기 위함
        lat: sql`coalesce(${refuelPoint.lat}, excluded.lat)`,
        lng: sql`coalesce(${refuelPoint.lng}, excluded.lng)`,
        // has_car_wash / has_maintenance / has_cvs / is_kpetro / tel — 의도적으로 없음
      },
    });
}
```

---

## 7. 적용된 작업 단계 (역사 기록)

### Phase A — 마스터 1회 구축

| | |
| --- | --- |
| 범위 | CSV 2개 파싱 → 병합 → 지오코딩 → `refuel_point` 적재 |
| 산출 | `scripts/import-price-csv.ts` |
| 오피넷 호출 | 17회 (`areaCode.do` 시군구 코드 확보, §3.3) |
| 카카오 호출 | 약 10,578회 (쿼터 100,000 내) |

1. EUC-KR → UTF-8 변환, **2행 메타행 스킵**
2. 메타행에서 기준일자(`20260904`) 파싱 → `priced_on`
3. `UNI_ID` 기준으로 주유소·충전소 CSV 병합 (겹치는 259건은 유종 컬럼 합침)
4. `상표` → `POLL_DIV_CD` 매핑 (§3.3)
5. `지역` → `SIGUNCD` 매핑 (§3.3)
6. 좌표 없는 행만 지오코딩 (§4)
7. `bulkUpsertFromCsv` (§6)

**완료 기준**
- `refuel_point` 11,785행 ± 신규분
- 좌표 확보 실패 행은 임포트에서 제외되고 `geocode-failures.json`에 기록
- 적재된 `refuel_point.lat/lng`는 모두 `NOT NULL`
- 기존 1,207건의 `coord_source='OPINET'` 유지 (지오코딩으로 덮이지 않았을 것)
- 기존 879건의 시설정보(`has_car_wash` 등) 무손실 — **임포트 전후 카운트 비교**

### Phase B — 스키마 · 마이그레이션

§5의 DDL을 `drizzle/`에 마이그레이션으로 추가하고 `src/infra/db/schema.ts`를 갱신합니다.
별도 평균가 테이블 삭제는 Phase C에서 완료되었습니다(마이그레이션 `drizzle/0002`).

### Phase C — 검색 경로 교체 ★ (핵심)

**`station-service.collectStations()`**

```
전환 전   : 샘플점 N개 × aroundAll.do → dedupe → DB 조인 → 필터
전환 당시 : 폴리라인 bbox 프리필터 → 후보 전량 조회 → d_perp 계산 → 필터

  SELECT * FROM refuel_point
   WHERE lat BETWEEN :minLat AND :maxLat        -- 폴리라인 bbox + T3_MAX 마진
     AND lng BETWEEN :minLng AND :maxLng
     AND price_{fuel} > 0                        -- A3
     AND last_seen_on >= :today - INTERVAL '7 days'
```

`d_perp` 계산은 기존 `pointToPolylineDistanceM`을 그대로 씁니다 — **도메인 로직은 손대지 않습니다.**

> 이후 다중 기본 경로와 STAGE 1·2 정책이 추가되었습니다. 현재 후보 수집·Valhalla 측정·정렬
> 순서는 [`PRODUCT.md`](PRODUCT.md) §6.6과 [`ARCHITECTURE.md`](ARCHITECTURE.md) §9.1이
> 정본이며, 위 의사코드는 오피넷 실시간 호출을 DB 조회로 바꾼 당시의 범위만 설명합니다.

**`recommendation-service.search()`**

- STEP0 예산 가드 삭제
- STEP5 확장 게이트 · STEP6 확장 수집 삭제 (회랑 쿼리가 T3까지 한 번에 덮음)
- STEP7 `P_ref`: 별도 평균가 테이블 조회 → **회랑 후보의 시군구·시도·전국 평균 폴백**으로 교체
- STEP9~11의 가격·추정 게이트는 유지합니다. 검색 중 후보별 카카오 경유 경로 호출은
  제거하고, 실제 경유 경로는 주유소 상세 화면의 `/api/detour`에서 호출합니다.

**완료 기준**
- 검색 1건의 오피넷 호출 = 0 (Redis 예산 카운터가 증가하지 않을 것)
- `sigun_cd`가 없는 행도 임포트·조회에서 안전하게 처리하며, 기준가를 구할 수 없으면 A14 가격순 폴백을 사용
- 기존 테스트(`recommendation-service.test.ts` 등) 통과 또는 명시적 갱신

### Phase D — 일일 갱신 파이프라인 ✅ (2026-09-06 완료)

```
GitHub Actions (05:00 KST)                Vercel Cron (05:40 KST, 안전망)
  → 오피넷 다운로드 (헤드리스 브라우저)      → Blob latest 읽기
  → 요청일·두 CSV 기준일 검증                 → 검증 게이트 G1~G8 (§8)
  → Vercel Blob 업로드 (latest + archive)   → 신규/좌표결손 행만 지오코딩
  → `?date=YYYYMMDD` 임포트 호출 ────────▶   → 스테이징 적재 → 원자적 스왑
    (불변 archive 지정)                      → csv_import_log 기록
```

**다운로드와 임포트를 분리했습니다 (결정 로그 ① 편차).** 실측해보니 오피넷 다운로드가
3중 게이트(진입 NetFunnel + `opinet_key` 세션 → 폼 프래그먼트 AJAX 로드 → 다운로드
NetFunnel) 뒤에 있고 서버 생성에 시간이 걸립니다. 순수 HTTP로 이 게이트들을 흉내내는 건
취약해서 **헤드리스 브라우저(Playwright)로 실제 페이지를 조작**합니다 — 브라우저가 JS
게이트를 전부 네이티브로 통과합니다. 이걸 Vercel 서버리스 함수에 넣으면 디버깅이 어렵고
조용히 깨지므로 GitHub Actions에서 돌립니다. 그래서:

| 부분 | 위치 | 파일 |
| --- | --- | --- |
| 스크래핑 (Playwright로 폼 조작 + 다운로드) | GitHub Actions | `src/infra/opinet/download.ts`, `scripts/download-opinet-csv.ts`, `.github/workflows/opinet-daily.yml` |
| CSV 보관 (`latest` 덮어쓰기 + `archive/{종류}-YYYYMMDD`) | Vercel Blob | `src/infra/blob/price-csv.ts` — Actions 트리거는 지정 archive, Cron은 `latest` |
| 파이프라인 본체 (게이트→지오코딩→스테이징→스왑→로그) | Vercel Cron | `src/services/price-import-service.ts`, `src/app/api/cron/import-prices/route.ts` |
| 게이트 G1~G8 | 순수 함수 | `src/infra/csv/gates.ts` (G1·G2는 `parse.ts`가 throw로 강제) |
| 지역→SIGUNCD 매핑 | Redis 30일 캐시 | `src/infra/opinet/sigun-map.ts` (미스 시에만 오피넷 17회) |

여전히 무인 자동화입니다 — 스크래핑 스케줄러만 Vercel Cron → GitHub Actions로 옮겼고,
**Blob은 수동 비상구**이기도 합니다(스크래핑이 깨지면 파일만 직접 올리면 임포트는 계속 돔).
임포트 API는 운영 정책상 게이트 실패도 HTTP 200을 반환하지만, GitHub Actions 호출부는
응답 본문의 `status`를 검사해 `OK`와 같은 기준일의 멱등 `G3`만 성공으로 처리합니다.

**원자적 스왑.** 8개 게이트를 전부 통과한 뒤에만 `refuel_point_staging`을 채우고,
반영은 `INSERT ... SELECT ... ON CONFLICT` **한 문장**으로 합니다(Neon HTTP 드라이버는
문장 하나가 곧 트랜잭션). SET 절은 `bulkUpsertFromCsv`와 같은 컬럼 소유권 규칙(§6) —
시설정보·`is_kpetro`·`tel`·`detail_synced_at`은 건드리지 않고, 좌표는 비어 있을 때만
채웁니다. 실패하면 `refuel_point` 무변경 → 어제 데이터로 계속 서비스됩니다.

**필요한 시크릿** (Vercel + GitHub 양쪽): `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
`APP_BASE_URL`(GitHub Actions가 임포트를 트리거할 때). `vercel.json`은 리전을 `icn1`로
고정하고 크론을 등록합니다.

### Phase E — 시설정보 백필 (무인, 34일) ✅ (2026-09-07 구현)

검색이 오피넷을 쓰지 않으므로 **280회 예산 전부를 백필에 씁니다.**

```
대상 : 주유소 10,237 − 완료 879 = 9,358개소
      (LPG 충전소 1,807개는 세차·정비가 무의미 → 제외)
소요 : 9,358 ÷ 280 ≈ 34일
```

| 부분 | 위치 | 파일 |
| --- | --- | --- |
| 오케스트레이터 (큐 조회 → 상세 API 병렬 호출 → 시설 컬럼만 UPDATE → 남은 건수 집계) | 순수 서비스 | `src/services/detail-backfill-service.ts` |
| 큐·UPDATE 리포지토리 (`findStationsNeedingDetailBackfill` / `updateDetailFields` / `markDetailSyncedEmpty` / `countStationsNeedingDetailBackfill`) | DB 접근 | `src/infra/db/repositories.ts` |
| 크론 진입점 (Bearer 인증, `maxDuration=300`) | Vercel Cron | `src/app/api/cron/backfill-details/route.ts` (`vercel.json`, `0 21 * * *` UTC = 06:00 KST — 임포트 크론 뒤) |
| 수동 실행 / 따라잡기 | 스크립트 | `scripts/backfill-details.ts` (`pnpm data:backfill-details [건수]`) |
| 1회 처리량 | 환경변수 | `OPINET_BACKFILL_LIMIT` (기본 280) |

**컬럼 소유권(§6) 준수.** `updateDetailFields`의 SET 절은 상세 API 소유 컬럼
(`has_car_wash`·`has_maintenance`·`has_cvs`·`is_kpetro`·`tel`·`detail_synced_at`)만
건드립니다 — 매일 도는 CSV 임포트가 소유한 `name`·`brand_code`·주소·`sigun_cd`·
`energy_type`·좌표·가격은 넣지 않습니다. 대상 행은 이미 CSV로 존재하므로 INSERT가
아닌 UPDATE입니다 (`upsertRefuelPointFromDetail`은 폴백 C — 신규 주유소 INSERT용이라
여기 쓰지 않습니다).

**상세 API에 없는 UNI_ID**(폐업 추정)는 `markDetailSyncedEmpty`가 `detail_synced_at`만
찍어 매일 재시도로 예산을 갉아먹지 않게 합니다. 호출이 throw하면(타임아웃 등) 그 건은
건너뛰고 다음 실행에서 재시도합니다.

**큐 우선순위**

전환 당시 검색 결과 노출 이력과 고속도로·주요 국도 인접도를 우선순위로 검토했지만 채택하지
않았습니다. 전자는 별도 노출 이력 계약이, 후자는 도로 지오메트리와 효과 검증이 필요하며 현재
제품 요구사항이 아닙니다.

현재 구현은 `ORDER BY last_seen_on DESC, id`입니다. 최근까지 CSV에 등장한(= 현재 영업 중,
검색에 잡힐 가능성 높은) 곳을 먼저 처리합니다.

큐가 `WHERE detail_synced_at IS NULL AND energy_type <> 'LPG' LIMIT 280`이므로 **대상이
없으면 저절로 멈춥니다.** 이후엔 CSV가 발견한 신규 주유소만 처리하며, 개·폐업률
연 3~5% 기준 **하루 1~2건** 수준입니다.

> **Vercel Cron 수.** 현재 프로젝트에는 `import-prices`와 `backfill-details` 두 개가 있습니다.
> Vercel은 2026-01-20부터 모든 플랜에서 프로젝트당 100개까지 허용하므로 두 개가 한도는
> 아닙니다. 새 크론을 추가할 때는 [Vercel 최신 한도](https://vercel.com/docs/limits)를 다시
> 확인하고, 실행 시간·함수 사용량·외부 API 쿼터를 함께 검토하십시오.

> **남는 예산은 비워두십시오.** 다운로드 자동화는 언젠가 깨집니다.
> 현재는 CSV 실패 시 `aroundAll.do`로 부분 갱신하는 자동 폴백이 없습니다. 남는 호출량은
> 지역코드 캐시 초기화·소량 수동 진단과 장애 조사 여유로 보존합니다. 자동 부분 갱신을
> 도입하려면 먼저 `PRODUCT.md`·`ARCHITECTURE.md`에 실패 조건, 갱신 범위, 사용자 표시 계약을
> 확정하고 테스트를 추가해야 합니다. 시설 정보의 주기적 전수 재검증은 변경 주기에 비해
> 실익이 작으므로 현재 수행하지 않습니다.

---

## 8. CSV 검증 게이트 ★

**하나라도 실패하면 DB를 건드리지 않고 중단합니다.**

| # | 규칙 | 임계값 | 잡아내는 사고 |
| --- | --- | --- | --- |
| G1 | 헤더 컬럼명 일치 | 11개 정확히 | 오피넷 포맷 변경 |
| G2 | 기준일자 일관성 | 2행 파싱 성공 + 행별 기간 일치 + 주유소·LPG 일치 | 다른 날짜·종류 또는 섞인 파일을 받아옴 |
| G3 | 기준일자 신규성 | `> last_imported_on` | 같은 파일 재수입 |
| G4 | 행 수 변동 | 직전 대비 ±10% | 잘린 파일 · 빈 파일 |
| G5 | `UNI_ID` 형식 | `A\d{7}` 100%, 중복 0 | ID 체계 변경 |
| G6 | 기존 ID 교집합 | ≥ 90% | 전혀 다른 데이터셋 |
| G7 | 휘발유 유효행 비율 | ≥ 95% | 가격 컬럼 밀림 |
| G8 | 가격 범위 이탈 | 1,000 ~ 4,000원 밖 < 0.5% | 단위 변경 · 인코딩 깨짐 |

> G4의 ±10%는 실측 기준입니다 — 2026-09-04 파일이 주유소 10,237행.
> 전국 주유소 수는 연 3~5%씩만 움직이므로 하루 사이 10% 변동은 정상이 아닙니다.

**실패 시 동작**

```
1. 스테이징 롤백 (refuel_point 무변경)
2. csv_import_log 에 status='GATE_FAILED', failed_gate='G4' 기록
3. 마지막 성공 스냅샷으로 검색 계속
4. 모든 가격 옆에 저장된 priced_on 기준일자 유지
5. 관리자 대시보드에서 실패 상태·게이트·상세 원인 확인
```

---

## 9. 함께 고쳐야 하는 것

### 9.1 가격 오래됨 배지 — 날짜만 표시하도록 정리 완료 ★ (2026-09-05 결정)

```
과거에는 `PRICE_STALE_HOURS`라는 시간 기준을 사용하려 했습니다.
```

일 1회 스냅샷은 실시간 가격이 아니므로, 화면에는 CSV 기준일자를 함께 표시합니다.

별도의 "오래된 정보" 낙인이나 추정 시각은 표시하지 않습니다. `pricedOn`이 없으면
기준일자 미상으로 표시합니다.

### 9.2 `approximateLastUpdateTime` 제거

과거에는 오피넷 갱신 스케줄로 시각을 추정했지만, 현재는 CSV의 실제 `priced_on`으로
교체했습니다. 표시 형식도 날짜형(`"2026-09-04 기준"`)입니다.

### 9.3 시설 필터 의미 명시 ✅ (2026-09-07 구현)

백필이 끝나기 전에는 **정보가 확인된 주유소만** 결과에 남습니다. 이건 별도 코드가
필요 없습니다 — `has_car_wash` 등은 스키마 기본값이 `false`이고 상세 API 백필로만
`true`가 되므로, `detail_synced_at IS NULL`인 행은 시설 필터에서 이미 자동 제외됩니다
(`station-service.matchesFilters`).

필터 적용 시 배너를 노출해 결과가 적은 이유가 데이터 커버리지임을 알립니다
(`result/page.tsx`의 `FacilityCoverageBanner`, `filters.facilities.length > 0`일 때):

> _"시설 정보가 확인된 주유소만 표시돼요. 데이터 보강이 진행 중이라 실제로는 더 많을 수 있어요."_

- 원안의 `"확인된 ‹n›곳 기준"`처럼 **숫자를 넣으려면** 서버가 회랑 후보 중
  `detail_synced_at IS NOT NULL` 개수를 세어 `SearchResult`에 실어야 합니다
  (Contract 추가). 백필이 ~34일 뒤 끝나면 이 배너 자체가 사라지므로, 지금은
  숫자 없는 정적 배너로 두고 플러밍은 생략했습니다.
- **백필 완료 시 `FacilityCoverageBanner`와 호출부를 함께 제거**하십시오.
  현황은 `pnpm data:backfill-details --status`로 확인합니다.

> **즉석 상세조회는 넣지 않습니다** (§11 결정 ⑤). 초반 커버리지 부족은 감수합니다.

### 9.4 셀프여부 필터 신규 추가 ✅ (2026-09-07 구현)

CSV에 100% 있고(셀프 6,268 / 일반 3,969) 실제 가격 차이가 나는 축입니다.

`filters.selfOnly: boolean`을 추가했습니다. 파이프라인:

```
filter-sheet.tsx 토글 → WireFilters.selfOnly → FiltersSchema(zod)
  → SearchInput.filters.selfOnly → station-service.matchesFilters
      → station.isSelf !== true 이면 제외 (미상 undefined도 제외)
```

- `RefuelPoint.isSelf?: boolean` 추가, `fromRefuelPointRow`가 `is_self` 컬럼을 매핑
  (null → undefined). 후보 확보 후 in-memory 필터라 DB 쿼리(`findRefuelPointsInBbox`)는
  건드리지 않았습니다 — 브랜드·시설·품질인증 필터와 동일한 위치.
- 문서 갱신: `PRODUCT.md` §2.2·§5.2(제공 필터로 이동, 안내 문구 수정),
  `ARCHITECTURE.md` §6.1 `Filters` 인터페이스.
- 필터 시트 하단 안내는 "운영시간 필터는 …"으로 축소.

---

## 10. 삭제 대상 코드 ✅ 완료

| 대상 | 위치 | 처리 커밋 |
| --- | --- | --- |
| 일일 예산 카운터·가드·소진 예외 | `opinet/budget.ts`, `isOpinetBudgetAvailable`, `QuotaExhaustedError` | Phase C (`399d0b6`) |
| 확장 수집 | `recommendation-service` STEP5·6, `geo.samplePolyline`·`geo.normalOffsets`, `tier.needsExpansion` | Phase C + 잔재 정리 (`a62602b`) |
| 확장 관련 타입 | `ExpansionInfo.skippedReason`, `WarningCode.QUOTA_EXCEEDED` | `a62602b` |
| 파라미터 | `params.MIN_CANDIDATES`, `params.OFFSET`, `params.SAMPLE_INTERVAL` | `a62602b` |
| 시군구 평균가 | 별도 `sigungu_avg_price` 테이블·동기화 크론은 `drizzle/0002`에서 제거. `findSigunguAvgPrice`/`findSido`/`findNational`은 이름을 유지한 채 `refuel_point` 집계로 재구현 | Phase C |
| 환경변수 | `OPINET_DAILY_BUDGET`, `FEATURE_EXPANSION_ENABLED` | Phase C + `a62602b` |

`fetchRadius`(`opinet/client.ts`)와 `tier.isOutOfRange`는 **남겨뒀습니다**. 전자는 회귀 테스트·
수동 진단용 호환 함수로 운영 검색·임포트에서 호출하지 않고, 후자는 확장과 무관한 유틸입니다.

---

## 11. 배포 후 절차

### 11.1 확인 항목

```sql
-- 백필 진행률
SELECT count(*) FILTER (WHERE detail_synced_at IS NOT NULL) AS done,
       count(*) AS total
  FROM refuel_point WHERE energy_type <> 'LPG';

-- 좌표 결손
SELECT coord_source, count(*) FROM refuel_point GROUP BY 1;

-- 임포트 이력
SELECT priced_on, status, failed_gate FROM csv_import_log ORDER BY id DESC LIMIT 7;
```

Redis 예산 카운터(`{prefix}:opinet:budget:{date}`)가 **검색으로는 증가하지 않는지** 확인하십시오.
증가한다면 Phase C가 덜 끝난 것입니다.

### 11.2 롤백

이전 `aroundAll.do` 검색 구현은 현재 코드에 남아 있지 않습니다. 문제가 생기면 Vercel의
직전 정상 배포로 롤백하고, DB 마이그레이션은 additive이므로 새 컬럼·테이블을 즉시 삭제하지
않습니다. 데이터 복구가 필요하면 마지막 성공 CSV archive와 `csv_import_log`를 기준으로
재임포트합니다.

### 11.3 문서 갱신 ✅ 완료 (2026-09-07)

[`ARCHITECTURE.md`](ARCHITECTURE.md)뿐 아니라 `PRODUCT.md`·`AGENTS.md`·`README.md`까지
현재 상태 기준으로 재작성했습니다("예전엔 이랬다" 서술은 번호 빈 목록·검증 기록에만 남김).

| 문서·섹션 | 조치 |
| --- | --- |
| ARCHITECTURE §5.1·§5.3·§5.3.1·§5.3.2·§5.4 | 오피넷 API를 데이터 원천 4종 표로, 검색 예산 0으로 |
| ARCHITECTURE §7.1·§7.2·§7.3 | `refuel_point` DDL 전체, `P_ref` 실시간 집계, `search_event` 컬럼 정리 |
| ARCHITECTURE §8·§9.1·§9.3·§6.1·§6.4·§11 | 캐시 축소, 흐름도, 배치 3종, 크론 라우트, 배포 |
| PRODUCT §5.2·§5.3·§6.2·§6.3·§7.1·§7.2·§9.1·§10 | 셀프 필터, 우회 고지 배너, 회랑 수집, 죽은 파라미터·예외 정리 |
| AGENTS·README | 데이터 전략·보안 쿼터·테스트·금지사항·`data:*` 파이프라인·환경변수 |
| ARCHITECTURE §10 Phase 본문 / `scripts/README-phase0.md` | "최초 구축 순서" 성격이라 배너만, 본문 유지 |

---

## 12. 결정 로그

| # | 항목 | 결정 | 근거 |
| --- | --- | --- | --- |
| ① | 데이터 수급 | **다운로드 자동화**. 검증 실패 시 새 파일 미반영. ~~크론~~ → 스크래핑은 GitHub Actions(Playwright), 임포트는 Vercel Cron(§7 Phase D — 3중 게이트 취약성 때문에 분리) | 수동 업로드는 운영 부담. 실패해도 어제 데이터로 서비스 지속 |
| ② | 좌표 조달 | **카카오 주소검색 지오코딩** (오피넷 좌표 우선) | 실측 중앙값 오차 15m ≪ `T1_MAX` 500m |
| ③ | 가격 저장 | **최신 스냅샷만 덮어쓰기** (이력 테이블 없음) | 이력 기반 기능은 현재 로드맵에 없음 |
| ④ | 시설정보 | **백그라운드 백필 280회/일 × 34일** | 검색이 예산을 안 쓰므로 전량 백필 가능 |
| ⑤ | 즉석 상세조회 | **채택 안 함** | 검색당 13~14회가 들어 현재 한도(하루 20건)가 그대로 재현됨. 초반 커버리지 부족은 감수 |
| ⑥ | 시설 필터 의미 | **정보 확인된 곳만 노출** + 배너 명시 | 미확인 주유소를 통과시키면 가서 보면 없을 수 있음 |
| ⑦ | 지원 유종 | **3종 유지** (휘발유·경유·LPG) | 고급휘발유·등유는 DB 적재만 하고 UI 미노출 |
| ⑧ | 실패 확인 | **가격별 기준일자 + 관리자 대시보드** | 사용자에게 구현되지 않은 장애 상태를 추정해 표시하지 않고, 실제 가격 날짜와 운영 로그를 각각 제공 |
| ⑨ | 공간 인덱스 | `refuel_point`는 `(lat, lng)` B-tree + bbox, 도로 링크는 **PostGIS GiST** | 주유소 마스터는 소규모지만 표준 링크 156만 건은 선분 거리·방위각 조회가 필요 |

---

## 13. 부수 발견과 해결 기록

CSV로 대조하는 과정에서 발견했고 전환 작업 중 해결한 버그 2건입니다. 현재 동작을 설명하는
계약이 아니라 회귀 원인을 남기는 역사 기록입니다.

### 13.1 `LPG_YN` 매핑 오류 — 해결됨

```ts
// 현재 src/infra/opinet/mapper.ts
if (lpgYn === "Y") return "LPG";
if (lpgYn === "C") return "BOTH";
return "OIL";
```

CSV로 검증한 결과, `energy_type='BOTH'`인 328건 중 **주유소 CSV에 있는 건 0건,
충전소 CSV에 251건**입니다. 즉 `Y`는 겸업이 아니라 **LPG 전용**이고, 겸업은 `C`입니다
([`ARCHITECTURE.md`](ARCHITECTURE.md) §7.1 스키마 주석 `LPG_YN: N/Y/C`와도 일치).

현재 매퍼 단위 테스트가 `N→OIL`, `Y→LPG`, `C→BOTH` 세 분기를 고정합니다.

### 13.2 브랜드 코드 오타 — 해결됨

```ts
// 현재 src/domain/types.ts
RTO: "자영알뜰",
```

DB 실데이터와 CSV 매퍼 모두 `RTO`를 사용하며, 필터에서는 `RTO`·`RTX`를 “알뜰” 한 그룹으로
묶습니다. 파서·필터 테스트가 이 매핑을 고정합니다.

---

## 14. 참고

- 원본 CSV: 오피넷 → 정보마당 → 유가 내려받기 → 과거 판매가격(주유소/충전소)
- 실측 기준 파일: `과거_판매가격(주유소)20260904-20260904.csv` (10,237행),
  `과거_판매가격(충전소)20260904-20260904.csv` (1,807행)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) §5.3 오피넷 호출 예산 · §7 DB 스키마 · §12 결정 로그
- [`PRODUCT.md`](PRODUCT.md) §8 `P_ref` 산출 · §9 튜닝 파라미터
