# 오피넷 API → DB 기반 전환 계획

> **상태: Phase A~D 완료, Phase E 미착수** — 2026-09-05 작성, 2026-09-06 갱신
>
> §7 Phase A(마스터 CSV 임포트)·Phase B(스키마)·Phase C(검색 경로 교체 — `collectStations` bbox
> 조회, 예산·확장 수집·`sigungu_avg_price` 전량 삭제, §9.1·§9.2 일자 기준 신선도 표시)·
> Phase D(일일 CSV 자동 갱신 파이프라인) 완료. 남은 건 Phase E(시설정보 백필).
> §11.3 문서 갱신(ARCHITECTURE.md)은 아직 하지 않았다.
>
> 이 문서는 검색 경로의 오피넷 실시간 호출을 **일 1회 CSV 임포트 + DB 조회**로 바꾸는
> 작업의 실행 문서입니다. 작업 중에 옆에 켜두고 단계별로 체크하십시오.
>
> 여기서 내린 결정은 [`ARCHITECTURE.md`](ARCHITECTURE.md)의 §5.3.1 · §5.3.2 · §7.1 · §7.2 · §12 ①을
> 대체합니다. **작업 완료 후** 해당 섹션들을 갱신하십시오 (§10 배포 후 절차).

---

## 1. 왜 바꾸는가

[`ARCHITECTURE.md`](ARCHITECTURE.md) §5.3.1이 확인한 제약이 그대로 남아 있습니다.

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
| 실패 시 | `lat`/`lng` NULL 유지 → 검색 후보에서 자동 제외 + 로그 |

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

기존 `last_price` / `last_price_prod`는 **유종별 컬럼으로 대체**되므로 Phase C 완료 후 제거합니다.
`GET /api/stations/:id`(`route.ts:32`)가 `lastPrice`를 쓰고 있으니 함께 옮겨야 합니다.

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

### 5.3 `sigungu_avg_price` — 삭제 예정

`P_ref` 폴백이 **전수 가격에서 직접 집계**로 바뀌므로 테이블과 일 17회 배치가 불필요해집니다.
단, **`sigun_cd` 매핑이 11,785건 전부 채워진 것을 확인한 뒤** 제거하십시오 (§7 Phase C 완료 기준).

삭제 대상: `sigungu_avg_price` 테이블 · `scripts/sync-sigungu-avg.ts` ·
`POST /api/cron/sync-sigungu` · `findSigunguAvgPrice` / `findSidoAvgPrice` / `findNationalAvgPrice`.

---

## 6. 컬럼 소유권 규칙 ★

**이 표를 어기면 매일 새벽 CSV 임포트가 시설정보를 지웁니다.**
세 소스가 같은 테이블을 쓰므로, 각자 자기 컬럼만 `SET` 절에 넣습니다.

| 컬럼 | 소유자 | CSV 임포트 |
| --- | --- | --- |
| `name` `brand_code` `address_road` `sigun_cd` | CSV | ✅ 덮어씀 |
| `is_self` `priced_on` `last_seen_on` | CSV | ✅ 덮어씀 |
| `price_gasoline` `price_diesel` `price_lpg` `price_premium` `price_kerosene` | CSV | ✅ 덮어씀 |
| `lat` `lng` `coord_source` | 지오코딩 | ⚠️ **NULL일 때만** |
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
        // 좌표는 없을 때만 — 오피넷 실좌표를 지오코딩 값으로 덮지 않기 위함
        lat: sql`coalesce(${refuelPoint.lat}, excluded.lat)`,
        lng: sql`coalesce(${refuelPoint.lng}, excluded.lng)`,
        // has_car_wash / has_maintenance / has_cvs / is_kpetro / tel — 의도적으로 없음
      },
    });
}
```

---

## 7. 작업 단계

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
- `lat IS NULL` 행이 전체의 1% 미만
- 기존 1,207건의 `coord_source='OPINET'` 유지 (지오코딩으로 덮이지 않았을 것)
- 기존 879건의 시설정보(`has_car_wash` 등) 무손실 — **임포트 전후 카운트 비교**

### Phase B — 스키마 · 마이그레이션

§5의 DDL을 `drizzle/`에 마이그레이션으로 추가하고 `src/infra/db/schema.ts`를 갱신합니다.
`sigungu_avg_price` 삭제는 여기서 하지 말고 Phase C 완료 후로 미룹니다.

### Phase C — 검색 경로 교체 ★ (핵심)

**`station-service.collectStations()`**

```
현재 : 샘플점 N개 × aroundAll.do → dedupe → DB 조인 → 필터
변경 : 폴리라인 bbox 프리필터 → 후보 전량 조회 → d_perp 계산 → 필터

  SELECT * FROM refuel_point
   WHERE lat BETWEEN :minLat AND :maxLat        -- 폴리라인 bbox + T3_MAX 마진
     AND lng BETWEEN :minLng AND :maxLng
     AND price_{fuel} > 0                        -- A3
     AND last_seen_on >= :today - INTERVAL '7 days'
```

`d_perp` 계산은 기존 `pointToPolylineDistanceM`을 그대로 씁니다 — **도메인 로직은 손대지 않습니다.**

**`recommendation-service.search()`**

- STEP0 예산 가드 삭제
- STEP5 확장 게이트 · STEP6 확장 수집 삭제 (회랑 쿼리가 T3까지 한 번에 덮음)
- STEP7 `P_ref`: `sigungu_avg_price` 조회 → **회랑 후보의 시군구 실제 중앙값**으로 교체
- STEP9~11 및 정밀 계산(카카오 경유 경로)은 **변경 없음**

**완료 기준**
- 검색 1건의 오피넷 호출 = 0 (Redis 예산 카운터가 증가하지 않을 것)
- `sigun_cd IS NULL`인 행 0건 → 확인 후 `sigungu_avg_price` 제거
- 기존 테스트(`recommendation-service.test.ts` 등) 통과 또는 명시적 갱신

### Phase D — 일일 갱신 파이프라인 ✅ (2026-09-06 완료)

```
GitHub Actions (05:00 KST)                Vercel Cron (05:40 KST, 안전망)
  → 오피넷 다운로드 (헤드리스 브라우저)      → Blob latest 읽기
  → Vercel Blob 업로드 (latest + archive)   → 검증 게이트 G1~G8 (§8)
  → 임포트 엔드포인트 호출 ──────────────▶   → 신규/좌표결손 행만 지오코딩
                                            → 스테이징 적재 → 원자적 스왑
                                            → csv_import_log 기록
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
| CSV 보관 (`latest` 덮어쓰기 + `archive/{종류}-YYYYMMDD`) | Vercel Blob | `src/infra/blob/price-csv.ts` |
| 파이프라인 본체 (게이트→지오코딩→스테이징→스왑→로그) | Vercel Cron | `src/services/price-import-service.ts`, `src/app/api/cron/import-prices/route.ts` |
| 게이트 G1~G8 | 순수 함수 | `src/infra/csv/gates.ts` (G1·G2는 `parse.ts`가 throw로 강제) |
| 지역→SIGUNCD 매핑 | Redis 30일 캐시 | `src/infra/opinet/sigun-map.ts` (미스 시에만 오피넷 17회) |

여전히 무인 자동화입니다 — 스크래핑 스케줄러만 Vercel Cron → GitHub Actions로 옮겼고,
**Blob은 수동 비상구**이기도 합니다(스크래핑이 깨지면 파일만 직접 올리면 임포트는 계속 돔).

**원자적 스왑.** 8개 게이트를 전부 통과한 뒤에만 `refuel_point_staging`을 채우고,
반영은 `INSERT ... SELECT ... ON CONFLICT` **한 문장**으로 합니다(Neon HTTP 드라이버는
문장 하나가 곧 트랜잭션). SET 절은 `bulkUpsertFromCsv`와 같은 컬럼 소유권 규칙(§6) —
시설정보·`is_kpetro`·`tel`·`detail_synced_at`은 건드리지 않고, 좌표는 비어 있을 때만
채웁니다. 실패하면 `refuel_point` 무변경 → 어제 데이터로 계속 서비스됩니다.

**필요한 시크릿** (Vercel + GitHub 양쪽): `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
`APP_BASE_URL`(GitHub Actions가 임포트를 트리거할 때). `vercel.json`은 리전을 `icn1`로
고정하고 크론을 등록합니다.

### Phase E — 시설정보 백필 (무인, 34일)

검색이 오피넷을 쓰지 않으므로 **280회 예산 전부를 백필에 씁니다.**

```
대상 : 주유소 10,237 − 완료 879 = 9,358개소
      (LPG 충전소 1,807개는 세차·정비가 무의미 → 제외)
소요 : 9,358 ÷ 280 ≈ 34일
```

**큐 우선순위**

1. 검색 결과에 노출됐는데 `detail_synced_at IS NULL`
2. 고속도로 · 주요 국도 인접
3. 나머지

큐가 `WHERE detail_synced_at IS NULL LIMIT 280`이므로 **대상이 없으면 저절로 멈춥니다.**
이후엔 CSV가 발견한 신규 주유소만 처리하며, 개·폐업률 연 3~5% 기준 **하루 1~2건** 수준입니다.

> **남는 예산은 비워두십시오.** 다운로드 자동화는 언젠가 깨집니다.
> CSV 임포트가 2일 이상 연속 실패하면, 사용자가 지나가는 시군구의 가격만
> 오피넷 API로 부분 갱신하는 비상 경로로 쓸 수 있습니다. 주기적 재검증 루프는
> 세차기·정비소가 몇 년 단위로만 바뀌므로 실익이 없습니다.

---

## 8. CSV 검증 게이트 ★

**하나라도 실패하면 DB를 건드리지 않고 중단합니다.**

| # | 규칙 | 임계값 | 잡아내는 사고 |
| --- | --- | --- | --- |
| G1 | 헤더 컬럼명 일치 | 11개 정확히 | 오피넷 포맷 변경 |
| G2 | 기준일자 파싱 | 2행에서 추출 성공 | 다른 파일을 받아옴 |
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
3. 사용자 화면 배너: "가격 정보가 2026-09-04 기준입니다 (2일 전)"
4. 3일 연속 실패 시 배너를 경고 톤으로 승격
```

---

## 9. 함께 고쳐야 하는 것

### 9.1 `PRICE_STALE_HOURS` — 시간 기준 배지 완전 제거 ★ (2026-09-05 결정으로 최종 확정)

```
src/domain/params.ts:33   PRICE_STALE_HOURS = 6
```

일 1회 스냅샷은 **항상 6시간보다 오래됐습니다.** 그대로 두면
`result-card.tsx`와 `station/[id]/page.tsx`가 **모든 카드에 "오래된 정보" 배지**를 답니다.

처음엔 `isPriceStale(date, now, hours)` → `isPriceStale(pricedOn, today, days)`로 바꿔
일자 기준(2일 초과 시 경고)으로 교체했으나, **제품 결정으로 "오래된 정보" 경고 문구 자체를
없앴습니다** — 날짜(`"2026-09-04 기준"`)만 그대로 보여주고 별도 낙인 문구는 달지 않습니다.
`isPriceStale`·`PRICE_STALE_DAYS`·`cache-ttl.ts`는 이제 안 씁니다(삭제).
`AGENTS.md` §6의 "오래된 정보 배지" 행도 이 결정에 맞춰 제거했습니다.

### 9.2 `approximateLastUpdateTime` 제거

`cache-ttl.ts`는 오피넷 갱신 스케줄(1·2·9·12·16·19시)에서 **추정한 시각**을 화면에 띄우고 있었습니다
(`recommendation-service.ts`, `stations/nearby/route.ts`).
CSV의 실제 `priced_on`으로 교체해 추정을 없앴고, 표시 형식도 날짜형(`"2026-09-04 기준"`)으로
바꿨습니다 (§9.1 결정에 따라 경과일 표시는 넣지 않음).

### 9.3 시설 필터 의미 명시

백필이 끝나기 전에는 **정보가 확인된 주유소만** 결과에 남깁니다
(`detail_synced_at IS NOT NULL AND has_car_wash`).
필터 적용 시 배너로 `"시설 정보가 확인된 ‹n›곳 기준"` 을 노출해,
결과가 적은 이유가 데이터 커버리지임을 알립니다.

> **즉석 상세조회는 넣지 않습니다** (§11 결정 ⑤). 초반 커버리지 부족은 감수합니다.

### 9.4 셀프여부 필터 신규 추가

CSV에 100% 있고(셀프 6,268 / 일반 3,969) 실제 가격 차이가 나는 축입니다.
`filter-sheet.tsx`에 토글을 추가합니다.

---

## 10. 삭제 대상 코드

| 대상 | 위치 |
| --- | --- |
| 일일 예산 카운터 전체 | `src/infra/opinet/budget.ts` |
| 예산 가드 | `station-service.isOpinetBudgetAvailable` |
| 예산 소진 예외 | `recommendation-service.QuotaExhaustedError` + SSE·API 라우트의 처리 분기 |
| 확장 수집 | `recommendation-service` STEP5·STEP6, `geo.normalOffsets` |
| 확장 관련 타입 | `ExpansionInfo.skippedReason`, `WarningCode.QUOTA_EXCEEDED` |
| 파라미터 | `params.MIN_CANDIDATES`, `params.OFFSET`, `params.SAMPLE_INTERVAL` |
| 시군구 평균가 | `sigungu_avg_price` 테이블, `scripts/sync-sigungu-avg.ts`, `POST /api/cron/sync-sigungu`, 관련 리포지토리 3함수 |
| 환경변수 | `OPINET_DAILY_BUDGET`, `FEATURE_EXPANSION_ENABLED` |

`fetchRadius`(`opinet/client.ts`)는 §7 Phase E의 비상 경로 후보이므로 **남겨둡니다.**

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

Phase C까지는 `collectStations`의 구현만 바뀌므로, 이전 구현을 남겨두고
환경변수로 전환하면 즉시 되돌릴 수 있습니다. `refuel_point`는 컬럼 추가만 했으므로
스키마 롤백이 필요 없습니다.

### 11.3 문서 갱신

작업 완료 후 [`ARCHITECTURE.md`](ARCHITECTURE.md)의 다음 섹션을 갱신하십시오.

| 섹션 | 조치 |
| --- | --- |
| §5.3.1 용량 한계 | 무효 — 해소됨으로 갱신 |
| §5.3.2 예산 소진 시 UX | 무효 — 삭제 |
| §7.1 마스터 구축 전략 | "폴백 C" → CSV 임포트로 대체 |
| §7.2 `sigungu_avg_price` | 삭제 |
| §12 ① 오피넷 일일 한도 | 결정 로그에 해소 기록 추가 |

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
| ⑧ | 실패 알림 | **사용자 화면 배너** | 별도 관리 도구 불필요 |
| ⑨ | 공간 인덱스 | **PostGIS 미사용**, `(lat, lng)` B-tree + bbox | 11,785행 규모에서 불필요한 의존성 |

---

## 13. 부수 발견 (이번 전환과 별개)

CSV로 대조하는 과정에서 나온 기존 버그 2건입니다. **이 작업과 무관하게** 고쳐야 합니다.

### 13.1 `LPG_YN` 매핑 오류

```ts
// src/infra/opinet/mapper.ts:76
return lpgYn === "Y" ? "BOTH" : "OIL";
```

CSV로 검증한 결과, `energy_type='BOTH'`인 328건 중 **주유소 CSV에 있는 건 0건,
충전소 CSV에 251건**입니다. 즉 `Y`는 겸업이 아니라 **LPG 전용**이고, 겸업은 `C`입니다
([`ARCHITECTURE.md`](ARCHITECTURE.md) §7.1 스키마 주석 `LPG_YN: N/Y/C`와도 일치).

현재 `EnergyType`에 `'LPG'`가 한 건도 쌓이지 않고 있습니다.

### 13.2 브랜드 코드 오타

```ts
// src/domain/types.ts:59
RTE: "자영알뜰",
```

DB 실데이터는 `RTO`입니다(26건 관측). `brandName("RTO")`가 "RTO"를 그대로 화면에 노출합니다.

---

## 14. 참고

- 원본 CSV: 오피넷 → 정보마당 → 유가 내려받기 → 과거 판매가격(주유소/충전소)
- 실측 기준 파일: `과거_판매가격(주유소)20260904-20260904.csv` (10,237행),
  `과거_판매가격(충전소)20260904-20260904.csv` (1,807행)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) §5.3 오피넷 호출 예산 · §7 DB 스키마 · §12 결정 로그
- [`PRODUCT.md`](PRODUCT.md) §8 `P_ref` 산출 · §9 튜닝 파라미터
