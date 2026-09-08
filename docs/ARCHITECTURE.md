# ARCHITECTURE.md — 오일픽 시스템 설계

> **이 문서의 관할: 어떻게 만드는가.**
> 시스템 구조, 모듈 책임, 데이터 흐름, 외부 API 정책, API Contract, DB 스키마, 캐시, 배포, 개발 순서, **미해결 검증 항목(§12)**.
> 기능 정의·계산식·파라미터는 [`PRODUCT.md`](PRODUCT.md)에 있습니다.
> 개발 규칙과 금지사항은 [`../AGENTS.md`](../AGENTS.md)에 있습니다.

---

## 1. System Overview

```
                    ┌──────────────────────────────┐
                    │  Browser (모바일 웹)          │
                    │  Next.js Client Components    │
                    │  · 홈 / 결과 / 상세 / 내주변   │
                    │  · Zustand store (+persist)   │
                    │  · lib/api 훅 (fetch 캡슐화)   │
                    │  · 카카오맵 JS SDK (상세만)    │
                    └───────────────┬──────────────┘
                                    │ HTTPS (SSE / REST)
                    ┌───────────────▼──────────────┐
                    │  Next.js Route Handlers (BFF) │
                    │  · API 키 보관 · 요청 검증     │
                    └───────────────┬──────────────┘
                                    │
      ┌─────────────────────────────┼─────────────────────────────┐
      │                             │                             │
┌─────▼──────┐  ┌───────────────────▼──────┐  ┌──────────────────▼─────┐
│  Services  │  │        Domain            │  │        Infra           │
│            │  │  (순수 계산 · 의존 0)     │  │  (외부 시스템 어댑터)   │
│ route      │  │  geo · tier · pricing    │  │  opinet · kakao        │
│ station    │◀─┤  reason · deeplink       │  │  cache(Redis) · db(PG) │
│ price      │  │  params · types          │  └──────────┬─────────────┘
│ recommend  │  └──────────────────────────┘             │
│ event      │                                           │
└────────────┘                                           │
                              ┌──────────────────────────┼──────────────┐
                              │                          │              │
                        ┌─────▼──────┐         ┌─────────▼──────┐  ┌───▼────┐
                        │  오피넷     │         │ 카카오모빌리티  │  │ Redis  │
                        │  무료 API   │         │ 카카오 로컬     │  │   PG   │
                        └────────────┘         └────────────────┘  └────────┘
```

### 1.1 핵심 설계 판단

| 판단                       | 이유                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BFF 필수**               | 오피넷 `certkey`와 카카오 REST 키를 브라우저에 노출하면 즉시 탈취되어 일일 한도가 소진됩니다. 클라이언트는 외부 API를 절대 직접 호출하지 않습니다                                        |
| **`domain`은 순수 함수**   | 금액·거리 계산이 이 제품 신뢰도의 전부입니다. 네트워크 없이 단위 테스트할 수 있어야 합니다                                                                                               |
| **마스터 DB 우선**         | 후보·가격·시설 정보를 전부 `refuel_point` 마스터에서 읽습니다. 검색 1건의 외부 데이터 API 호출은 카카오 경로뿐입니다. 마스터는 일 1회 유가 CSV 임포트로 가격을, 백그라운드 크론으로 시설 정보를 갱신합니다 (근거·상세는 [`MIGRATION-DB.md`](MIGRATION-DB.md)) |
| **SSE 스트리밍**           | 경유 경로 정밀 계산에 수 초가 걸립니다. 단계별 진행을 실제로 알려주지 않으면 [`PRODUCT.md`](PRODUCT.md) §10.3의 로딩 UI가 가짜 애니메이션이 됩니다                                       |
| **SSE + JSON 폴백**        | 카카오톡 등 인앱 브라우저에서 스트림이 버퍼링되면 사용자가 아무것도 못 받습니다. **같은 서비스 함수를 콜백 없이 호출하면 그게 곧 REST 응답**이라 서버 추가 비용이 거의 없습니다 (§6.2.1) |
| **서버리스 친화 드라이버** | Neon HTTP 드라이버 + Upstash REST. 인스턴스가 매 요청 새로 뜨므로 TCP 커넥션 풀이 무의미하고, 오히려 커넥션 고갈을 부릅니다                                                              |
| **상태는 Zustand 하나**    | 검색 결과·`vehicle`·필터가 라우팅을 넘나듭니다. 서버 상태는 사실상 "검색 결과 1개"뿐이라 서버 상태 라이브러리를 두지 않습니다 ([`../AGENTS.md`](../AGENTS.md) §7.5)                      |

---

## 2. 폴더 구조와 레이어 규칙

```
oilpick/
├── AGENTS.md
├── README.md
├── .env.example
├── docs/{PRODUCT,ARCHITECTURE,MIGRATION-DB,DESIGN}.md
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 홈 (F1)
│   │   ├── result/page.tsx             # 결과 목록 (F3·F4·F7)
│   │   ├── station/[id]/page.tsx       # 상세 (F8·F9)
│   │   ├── nearby/page.tsx             # 내 주변 (F10)
│   │   └── api/
│   │       ├── _lib/                   # 서버 전용 — schema·validate·serialize·sse (Phase 8)
│   │       ├── search/route.ts         # SSE
│   │       ├── detour/route.ts
│   │       ├── places/search/route.ts
│   │       ├── stations/nearby/route.ts
│   │       ├── stations/[id]/route.ts
│   │       ├── events/navi/route.ts
│   │       └── cron/{import-prices,backfill-details}/route.ts
│   ├── domain/                         # ★ 외부 의존 0
│   │   ├── params.ts                   # 튜닝 파라미터 단일 출처
│   │   ├── types.ts
│   │   ├── geo.ts
│   │   ├── tier.ts
│   │   ├── pricing.ts
│   │   ├── reason.ts
│   │   └── deeplink.ts
│   ├── services/
│   │   ├── route-service.ts
│   │   ├── station-service.ts          # bbox(회랑) 후보 조회 + 필터
│   │   ├── price-service.ts
│   │   ├── recommendation-service.ts   # 파이프라인 STEP 1~11
│   │   ├── price-import-service.ts     # 일 1회 유가 CSV 임포트
│   │   ├── detail-backfill-service.ts  # 시설 정보 백필 크론
│   │   └── event-service.ts
│   ├── infra/
│   │   ├── opinet/{client,mapper,katec,download,sigun-map}.ts
│   │   ├── csv/{parse,gates,types}.ts  # 유가 CSV 파싱·검증 게이트
│   │   ├── geocode/geocode-station.ts  # 카카오 지오코딩 (좌표 조달)
│   │   ├── blob/price-csv.ts           # Vercel Blob (CSV 보관)
│   │   ├── kakao/{schema,mapper,http,mobility,local}.ts
│   │   ├── cache/{redis,keys}.ts       # Upstash REST 래퍼
│   │   └── db/{schema,client,repositories}.ts   # Drizzle
│   ├── store/
│   │   └── search-store.ts             # Zustand — 검색결과·vehicle·필터·최근검색
│   ├── components/
│   └── lib/
│       └── api/                        # ★ 서버 호출 훅. 컴포넌트는 fetch를 직접 쓰지 않음
│           ├── useSearchStream.ts      #   SSE 소비 + JSON 폴백 (§6.2.1)
│           ├── usePlacesSearch.ts
│           ├── useNearbyStations.ts
│           ├── useStationDetail.ts
│           └── useDetour.ts
├── drizzle/                            # 생성된 마이그레이션 SQL — 커밋 대상
├── scripts/
│   ├── import-price-csv.ts             # pnpm data:import-csv (마스터 1회성 재구축)
│   ├── download-opinet-csv.ts          # pnpm data:download-csv (GitHub Actions가 실행)
│   ├── backfill-details.ts             # pnpm data:backfill-details [--status]
│   └── verify/
│       ├── _shared.ts                  # 콘솔 출력 · requireEnv 등 공통 유틸
│       ├── _routes.ts                  # Phase 5 측정용 노선 4개 (§10 Phase 5)
│       ├── _measure-shared.ts          # Phase 5 스크립트 공용 — 노선·연료 인자 파싱
│       ├── coord.mts                   # verify:coord          (③)  Phase 0
│       ├── standard-data.mts           # verify:standard-data  (②)  Phase 0
│       ├── price-time.mts              # verify:price-time     (⑪)  Phase 0
│       ├── upstash.mts                 # verify:upstash        (⑬)  Phase 0
│       ├── coverage.mts                # verify:coverage       (⑫)  Phase 5
│       ├── t3-rate.mts                 # verify:t3-rate              Phase 5
│       ├── uturn.mts                   # verify:uturn          (④)  Phase 5
│       └── detour.mts                  # verify:detour         (⑭)  Phase 10
└── tests/
    ├── fixtures/                       # ★ 실 응답 (MSW용)
    │   ├── opinet-radius.json              # aroundAll.do — 비상 폴백 경로 테스트용
    │   ├── opinet-detail.json              # detailById.do — 시설 정보 백필
    │   ├── opinet-area-code.json           # areaCode.do    — 지역→SIGUNCD 매핑
    │   ├── opinet-avg-sigun-price.json     # avgSigunPrice.do — 지역→SIGUNCD 매핑
    │   ├── kakao-directions.json
    │   ├── kakao-directions-waypoint.json  # 경유지 1개 포함 응답
    │   └── kakao-local.json
    ├── msw/                            # 핸들러 정의
    └── e2e/                            # Playwright 2개
```

> **`scripts/verify/`는 루트 프로젝트에서 `tsx`로 실행합니다** (`pnpm verify:*`). Phase 0 초기엔 `scripts/` 밑에 별도 `package.json`을 둔 독립 프로젝트였지만(Next.js가 아직 없어서), Phase 5부터 `@/domain`·`@/infra`를 그대로 재사용해야 해서 루트로 흡수했습니다. 진입 스크립트가 `.mts`인 이유는 최상위 `await`를 쓰기 때문 — 루트 `package.json`엔 `"type": "module"`이 없어서 확장자로 ESM임을 명시해야 합니다(루트의 `vitest.config.mts`와 같은 이유). `_`로 시작하는 파일은 진입점이 아니라 공용 유틸입니다.

### 2.1 import 방향

**규칙의 정본은 [`../AGENTS.md`](../AGENTS.md) §7.1입니다.** 요약하면 `app → services → domain/infra`이고, **`domain/`은 아무것도 import 하지 않습니다** (fetch·db·redis·`next/*`·`Date.now()` 전부 금지).

---

## 3. Module Responsibility

### 3.1 domain — 순수 계산

| 모듈           | 책임                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `params.ts`    | 튜닝 파라미터 상수. 값의 정본은 [`PRODUCT.md`](PRODUCT.md) §9                                                                             |
| `types.ts`     | `WGS84Point` / `KatecPoint` / `ProjectedPoint` / `RefuelPoint` / `Candidate` / `SearchResult` 등. **좌표 타입은 서로 대입 불가하게 분리** |
| `geo.ts`       | WGS84 ↔ 투영좌표 변환, `pointToPolylineDistance`(`d_perp`), bbox 계산, 격자 스냅                          |
| `tier.ts`      | `d_perp` → T1/T2/T3/제외 분류                                                                             |
| `pricing.ts`   | `computeReferencePrice`, `netSaving`, `computeScores`, `removeOutliers`                                   |
| `reason.ts`    | 추천 이유 템플릿 6분기. **LLM 금지**                                                                      |
| `deeplink.ts`  | 카카오맵·네이버지도·티맵 URL 생성                                                                         |

### 3.2 services — 오케스트레이션

| 모듈                      | 책임                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `route-service`           | 기본 경로·경유 경로 조회, 폴리라인 정규화, 경로 캐시. 카카오 응답을 도메인 타입으로 변환                 |
| `station-service`         | 경로 폴리라인 bbox(회랑) 계산 → `refuel_point` 후보 조회 → 필터 적용. 외부 호출 없음                     |
| `price-service`           | 이상치 제거, **`P_ref` 산출** — T1+T2 중앙값, 부족하면 `refuel_point` 시군구→시도→전국 가중평균          |
| `recommendation-service`  | **파이프라인 STEP 1~11 전체.** 진행 상황을 콜백으로 방출해 SSE로 흘려보냄                                |
| `price-import-service`    | 유가 CSV 임포트 오케스트레이션 (decode→parse→게이트→지오코딩→스테이징→원자 스왑). cron·스크립트 공유    |
| `detail-backfill-service` | 시설 정보 백필 (큐 조회→상세 API 병렬 호출→시설 컬럼 UPDATE). cron·스크립트 공유                         |
| `event-service`           | 익명 검색·딥링크 이벤트 기록 (Phase 11 — 현재 스텁)                                                      |

### 3.3 infra — 외부 시스템

| 모듈               | 책임                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `opinet/client`    | 상세정보·지역코드·시군구 평균가 호출. `fetchRadius`(반경검색)는 비상 폴백으로만 유지. 재시도·타임아웃·동시성 제한 |
| `opinet/katec`     | WGS84 ↔ KATEC 변환 (§4)                                                                          |
| `opinet/mapper`    | 오피넷 응답 필드 → 도메인 타입. **`UNI_ID`·`OS_NM` 같은 원본 필드명이 이 모듈 밖으로 나가면 안 됨** |
| `opinet/download`  | Playwright로 유가 CSV 스크래핑 (GitHub Actions에서 실행)                                          |
| `opinet/sigun-map` | `지역` 텍스트 → `SIGUNCD` 매핑. Redis 30일 캐시, 미스 시 오피넷 17회                             |
| `csv/*`            | 유가 CSV 파싱(EUC-KR 디코딩·메타행 처리)·병합·검증 게이트 G1~G8                                   |
| `geocode/*`        | 카카오 주소검색→키워드검색 폴백으로 주유소 좌표 조달                                              |
| `blob/*`           | Vercel Blob — 유가 CSV `latest` / `archive` 보관                                                 |
| `kakao/mobility`   | 길찾기(경유지 0~1개)                                                                             |
| `kakao/local`      | 키워드 장소 검색·주소 지오코딩                                                                   |
| `cache/*`          | Redis 래퍼, 키 생성 규칙                                                                         |
| `db/*`             | 스키마·마이그레이션·리포지토리                                                                   |

---

## 4. 좌표계 — 1순위 버그 원천

세 좌표계를 동시에 다룹니다. **타입으로 구분하고 절대 섞지 마십시오.**

| 좌표계                    | 쓰는 곳                                       | 타입             |
| ------------------------- | --------------------------------------------- | ---------------- |
| **WGS84** (위경도)        | 지도 SDK, 카카오 API, 저장, 클라이언트 전달   | `WGS84Point`     |
| **KATEC (TM128)**         | 오피넷 요청·응답                              | `KatecPoint`     |
| **EPSG:5179** (미터 투영) | `d_perp`·bbox·격자 스냅 등 모든 거리 계산 | `ProjectedPoint` |

```
오피넷 호출 전 : WGS84 → KATEC
오피넷 응답 후 : KATEC → WGS84  (이후 저장·표시는 전부 WGS84)
거리 계산 시   : WGS84 → EPSG:5179
```

**규칙**

1. **내부 계산은 WGS84 또는 EPSG:5179로 통일하고, 오피넷 호출 직전에만 KATEC으로 변환합니다.**
2. **거리 계산은 반드시 EPSG:5179에서.** 위경도(도 단위)로 하면 위도에 따라 왜곡됩니다
3. 변환은 `proj4`를 사용합니다

**투영 정의** `[검증 필요 — §12 ③]`

```
EPSG:5179 (Korea 2000 / Unified CS)
  +proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000
  +ellps=GRS80 +units=m +no_defs

KATEC / TM128 (오피넷)
  +proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000
  +ellps=bessel +units=m +no_defs
  +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43
```

> ⚠️ **Phase 0에서 `pnpm verify:coord`로 실측하십시오.** 알려진 주유소 좌표로 왕복 변환해 오차가 50m를 넘으면 반경 검색과 우회 계산이 전부 어긋납니다. `towgs84` 파라미터가 특히 결과를 크게 바꿉니다.

---

## 5. External API

### 5.1 오피넷 (한국석유공사)

전국 가격·시설 정보의 원천입니다. 검색 요청 경로에서는 호출하지 않고, 아래는 전부
배치·크론·CSV 임포트에서만 씁니다. 데이터 수급 구조의 배경은 [`MIGRATION-DB.md`](MIGRATION-DB.md).

| 데이터 원천 | 형식 | 용도 | 호출 시점 |
| --- | --- | --- | --- |
| **"과거 판매가격" CSV** (정보마당) | 웹 다운로드 (EUC-KR) | 전국 주유소·충전소 가격·상표·주소·셀프여부 전수 스냅샷. `번호` 컬럼 = `UNI_ID` | GitHub Actions가 일 1회 스크래핑 → Vercel Blob → 임포트 (§9.3) |
| **주유소 상세정보(ID)** `detailById.do` | JSON API | 시설(세차·정비·편의점)·품질인증·전화 — CSV에 없는 항목 백필 | 백필 크론 `GET /api/cron/backfill-details`, ≤280건/일 |
| **지역코드·시군구 평균가격** `areaCode.do` / `avgSigunPrice.do` | JSON API | 유가 CSV의 `지역` 텍스트 → `SIGUNCD` 매핑 (`P_ref` 시군구 집계 키) | CSV 임포트 시 Redis 캐시 미스일 때만 (17회, 30일 캐시) |
| **반경 내 주유소** `aroundAll.do` | JSON API | 비상 폴백 전용 — CSV 임포트가 2일+ 연속 실패 시 사용자가 지나가는 시군구만 부분 갱신 (MIGRATION-DB.md §7 Phase E). 평상시 미사용 | — |

**유료 API 3종(지역별 기본정보·판매가격·변경정보)은 쓰지 않습니다.** 전국 가격은 무료
JSON API로 한 번에 받을 수 없지만, "과거 판매가격" CSV가 전국 전수 스냅샷을 제공합니다.

**`aroundAll.do` 요청 (비상 폴백)**

| 파라미터  | 값                                                   |
| --------- | ---------------------------------------------------- |
| `certkey` | 인증키 (서버 전용)                                   |
| `out`     | `json`                                               |
| `x`, `y`  | 기준 좌표 (**KATEC**)                                |
| `radius`  | **최대 5000** (m) — 초과 불가                        |
| `prodcd`  | `B027` 휘발유 / `D047` 경유 / `K015` 자동차부탄(LPG) |
| `sort`    | `1` 가격순                                           |

**응답 → 도메인 매핑** (반경검색·상세 공통)

| 오피넷           | 도메인           | 비고                                          |
| ---------------- | ---------------- | --------------------------------------------- |
| `UNI_ID`         | `id`             | PK. 유가 CSV `번호` 컬럼과 동일               |
| `POLL_DIV_CD`    | `brandCode`      | 표시명 매핑은 [`PRODUCT.md`](PRODUCT.md) §5.2 |
| `OS_NM`          | `name`           |                                               |
| `PRICE`          | `price`          |                                               |
| **`GIS_X_COOR`** | **`lng`** (경도) | ★ X → 경도                                    |
| **`GIS_Y_COOR`** | **`lat`** (위도) | ★ Y → 위도. 뒤집으면 전국이 어긋납니다        |

**가격 기준일자**

유가 CSV 2행 메타행에서 기준일자를 파싱해 `refuel_point.priced_on`에 적재합니다. 일 1회
스냅샷이므로 화면에는 **날짜만** 표시합니다: `"2026-09-04 기준"`. `TRADE_DT`/`TRADE_TM`는
오피넷 JSON 응답 어디에도 없습니다 (`verify:price-time`, §12 ⑪).

**상업적 이용** `[확인됨]` — 석유공사 콘텐츠로 수익을 얻으려면 **사전 협의가 필요합니다.** 광고를 붙이기 전에 문의하십시오 (052-216-2514 / price@knoc.co.kr).

### 5.2 카카오모빌리티 길찾기 · 카카오 로컬

| 항목                                        | 값                                       |
| ------------------------------------------- | ---------------------------------------- |
| 무료 쿼터 (자동차 길찾기)                   | **일 10,000건**                          |
| 무료 쿼터 (지도 SDK)                        | 일 300,000건                             |
| 무료 쿼터 (로컬 API — 키워드 검색·좌표변환) | 각 일 100,000건                          |
| 경유지                                      | 자동차 최대 5개 (이 서비스는 1개만 사용) |
| 연료 옵션                                   | `car_fuel`: GASOLINE / DIESEL / **LPG**  |
| 경로 회피 옵션                              | `avoid`: `\|`로 연결. 이 서비스는 `motorway`(고속도로·자동차전용도로)만 사용 — PRODUCT.md §5.1 |
| 초과 요금                                   | 8원/건                                   |
| 거리 제한                                   | 경유지 포함 1,500km 미만                 |

**왜 카카오인가**

1. **무료 쿼터가 압도적** — 검색당 7회를 쓰므로 일 1,400회 검색 가능
2. **TMAP은 요금 절벽이 위험** — 무료 일 1,000건, 초과 시 정액 Lite 월 220만원
3. **네이버 Directions 15는 월 3,000건**(일 100)이라 경유지 계산에 쓸 수 없음

**앱 키 정책 ★**

> **2026-07-21부터 카카오맵 API 무료 쿼터는 개발자 계정의 "첫 번째로 활성화한 앱"에만 제공됩니다.**
> 두 번째 앱부터는 유료입니다. 따라서 **개발용·운영용 앱 키를 분리할 수 없습니다.** dev·prod가 단일 앱 키를 공유하며, 환경 오염은 §11.2의 방법으로 줄입니다.

> **로컬 API는 콘솔에서 별도 활성화가 필요합니다.** "제품 설정 → 카카오맵"이 꺼져 있으면 키가 유효해도 `NotAuthorizedError: disabled OPEN_MAP_AND_LOCAL service`로 즉시 실패합니다. 길찾기(모빌리티)와는 별개 토글입니다.

**응답 → 도메인 매핑 (`infra/kakao/mapper.ts`)**

길찾기 응답은 `routes[0].sections[].roads[].vertexes`(경도·위도가 평탄화된 배열, `[lng, lat, lng, lat, ...]` 순서)를 순서대로 이어붙여 `BaseRoute.polyline`을 만듭니다. 기본 경로(R₀)·경유 경로(R_s) 모두 같은 구조라 매핑 함수를 공유합니다. `result_code !== 0`이면 경로 탐색 실패로 간주해 에러를 던집니다 — 그 라운드만 실패 처리하는 것은 `route-service`(Phase 7)의 몫입니다.

| 카카오 (길찾기)              | 도메인 (`BaseRoute`) | 비고                          |
| ----------------------------- | --------------------- | ----------------------------- |
| `summary.distance`             | `distanceM`            | 미터, 정수                    |
| `summary.duration`             | `durationS`            | 초, 정수                      |
| `sections[].roads[].vertexes` | `polyline`             | `[lng,lat,...]` → `WGS84Point[]` |

로컬 검색 응답의 `x`/`y`는 길찾기 API와 달리 **문자열**로 내려옵니다 (`"127.02..."`). 주소는 도로명(`road_address_name`) 우선, 없으면 지번(`address_name`) — `RefuelPoint`와 동일한 우선순위(PRODUCT.md §6.2)를 씁니다.

| 카카오 (로컬 검색)     | 도메인 (`PlaceResult`) | 비고                          |
| ----------------------- | ------------------------ | ----------------------------- |
| `place_name`             | `name`                    |                               |
| `road_address_name`      | `address`                 | 없으면 `address_name` 폴백    |
| `x` (문자열)             | `location.lng`            | `Number()` 변환               |
| `y` (문자열)             | `location.lat`            | `Number()` 변환               |

### 5.3 호출 예산

검색 1건이 쓰는 외부 API는 **카카오 경로뿐**입니다. 후보·가격·시설 정보는 `refuel_point`
회랑 bbox 쿼리(수십 ms) 한 번으로 끝나고, 오피넷 호출은 0입니다.

| 시나리오                 | 오피넷 | 카카오 경로                          | 목표 응답 |
| ------------------------ | ------ | ----------------------------------- | --------- |
| 검색 1건                 | 0      | 1 (기본 경로) + 정밀 최대 `MAX_PRECISE` = **≤16** | 2~4초 |
| 카드 탭 (lazy 정밀 계산) | 0      | 1                                   | 1초       |

카카오 경로 무료 쿼터는 일 10,000건이라 검색 **600건/일**까지 여유가 있습니다 (경유 경로는
1시간 캐시·10m 격자를 타므로 인기 O/D가 반복되면 실사용 여유는 이보다 큽니다).

> **`MAX_PRECISE`를 6에서 15로 올렸습니다** (2026-09-08). 화면에 올리는 후보를 전부 실측하기
> 위해서입니다 — 이유는 [`PRODUCT.md`](PRODUCT.md) §7.3. 검색 1건의 경로 호출이 7 → 16회로
> 늘어 하루 처리 가능 검색 수가 1,400 → 600건이 됩니다. 15개는 `Promise.allSettled` 병렬
> 호출이라 응답 시간은 거의 그대로입니다(경유 경로 타임아웃 5초·재시도 0회, `maxDuration` 20초).
>
> **Upstash 쪽이 먼저 바인딩될 수 있습니다.** 경로 1건당 `GET` + (미스 시) `SET`이라 검색
> 1건이 Redis 명령 약 32회를 씁니다. 무료 티어 일 10,000회 기준 약 300검색/일입니다 (§12 ⑬).

**오피넷 일 예산 (300회/일)** 은 전량 **시설 정보 백필 크론**(§9.3)에 씁니다. 검색이
예산을 쓰지 않으므로 백필이 끝나면(§12 ①) 남는 예산은 CSV 임포트 비상 폴백용으로만
비워둡니다.

### 5.3.1 오피넷 일일 호출 한도 300회 — 검색 규모에는 영향 없음

한도 자체는 유효합니다(하루 300회, `verify:*`로 확인). 다만 **검색 경로가 오피넷을
호출하지 않으므로** "하루에 몇 명이 쓸 수 있는가"를 제약하지 않습니다. 300회는
백필 크론(≤280건/일)과 CSV 임포트 폴백만 소비합니다.

| 항목 | 값 |
| --- | --- |
| 검색 1건당 오피넷 호출 | 0 |
| 하루 가능 검색 수 | 카카오 쿼터가 상한 (≈1,400건/일) |
| 마스터 커버리지 | 11,785개소 (유가 CSV 전수) |

### 5.3.2 데이터 신선도 안내

가격은 일 1회 CSV 임포트로 갱신됩니다. 임포트가 실패하면 **어제 데이터로 계속
서비스**하고, 화면 배너에 기준일자를 노출합니다: `"가격 정보가 2026-09-04 기준입니다"`.
3일 연속 실패 시 배너를 경고 톤으로 승격합니다 (MIGRATION-DB.md §8). 검색을 막거나
SSE를 닫지 않습니다.

### 5.4 장애 처리와 타이밍

| 대상                    | 타임아웃 | 재시도  | 실패 시                             |
| ----------------------- | -------- | ------- | ----------------------------------- |
| 카카오 기본 경로        | 5초      | 1회     | 전체 중단 (오류 화면)               |
| 카카오 경유 경로        | 5초      | **0회** | 해당 후보만 추정치 유지 (A8)        |
| 카카오 로컬 검색        | 3초      | 1회     | 검색 실패 안내                      |
| 오피넷 상세 (백필 크론) | 4초      | 1회     | 그 건은 건너뛰고 다음 실행에서 재시도 |

검색 경로에는 오피넷 호출이 없어 반경검색 관련 타임아웃·재시도 항목이 없습니다.
회랑 bbox 쿼리는 DB 조회 한 번(수십 ms)이라 별도 타이밍 예산을 두지 않습니다.

**동시성:** `OPINET_CONCURRENCY`(기본 8) — 백필 크론의 상세 API 병렬 호출 상한.

**전체 예산:** 검색 1건의 총 처리 시간 상한 **12초**. 초과 시 확보한 후보로 응답하고 A11로
고지합니다. 목표 응답 시간(§5.3)은 정상 경로 기준입니다.

### 5.5 외부 내비 딥링크

| 앱             | 스킴                                                                                    | 경유지                  |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| **카카오맵**   | `kakaomap://route?sp={slat},{slng}&ep={elat},{elng}&by=car&vp={vlat},{vlng}`            | 최대 5개 (`vp`~`vp5`)   |
| **네이버지도** | `nmap://route/car?slat=&slng=&sname=&dlat=&dlng=&dname=&v1lat=&v1lng=&v1name=&appname=` | 최대 5개 (`v1`~`v5`)    |
| **티맵**       | `tmap://route?rGoName=&rGoX=&rGoY=`                                                     | **목적지만**            |
| 구글지도       | **미사용**                                                                              | 한국 자동차 내비 미지원 |

**폴백 처리**

| 환경                                    | 처리                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| Android                                 | `intent://...#Intent;scheme=nmap;S.browser_fallback_url=...;end` |
| iOS                                     | 스킴 시도 후 타이머로 App Store 폴백 분기                        |
| 인앱 브라우저 (카카오톡·삼성 인터넷 등) | 동작이 제각각 → "외부 브라우저로 열기" 안내                      |
| 데스크톱                                | 웹 지도 링크 또는 QR 코드                                        |

**경유지 전달 실기기 확인 (2026-08-28)** — 카카오맵·네이버지도는 **경유지가 정상 반영됨**(성남시청 → 대전시청 경유 → 부산역). 티맵은 커뮤니티 자료의 `rV1*`를 붙여도 **무시됨** → 주유소를 목적지로 전달하는 방식 유지(§12 ⑧).

> ⚠️ **실기기 매트릭스 테스트가 필요합니다(§12 ⑤).** 위 확인은 스킴 1대 동작까지입니다. iOS/Android/카카오톡 인앱 브라우저 조합과 SSE 폴백은 별개이며, 딥링크는 이 서비스의 최종 전환 지점이라 여기서 막히면 앞의 모든 계산이 무의미해집니다.

---

## 6. API Contract

**모든 엔드포인트는 서버에서만 외부 API 키를 사용합니다.** 클라이언트는 이 계약만 압니다.

### 6.1 공통 타입

```ts
type Fuel = "GASOLINE" | "DIESEL" | "LPG";
type Tier = "T1" | "T2" | "T3";
type Facility = "CAR_WASH" | "MAINTENANCE" | "CVS";
type Mode = "balanced" | "minCost" | "minDistance";
type RefPriceSource = "MEDIAN_T1T2" | "SIGUNGU_AVG";

interface Point {
  lat: number;
  lng: number;
  name?: string;
}

interface Vehicle {
  efficiency: number; // km/L
  refuelAmount: number; // L
  timeValue: number; // 원/분
}

interface Filters {
  facilities: Facility[];
  brands: string[]; // 오피넷 POLL_DIV_CD. "알뜰" 선택 시 RTO·RTX 둘 다 포함
  kpetroOnly: boolean;
  selfOnly: boolean; // refuel_point.is_self=true만. 미상(null)은 제외 (MIGRATION-DB.md §9.4)
}

interface Candidate {
  id: string;
  name: string;
  brand: string; // POLL_DIV_CD
  lat: number;
  lng: number;
  address: string;
  tel: string | null;
  price: number; // 원/L
  priceUpdatedAt: string | null; // ISO8601. §5.1 검증 전까지 null 가능
  facilities: { carWash: boolean; maintenance: boolean; cvs: boolean };
  kpetro: boolean;
  tier: Tier;
  perpDistanceM: number; // d_perp
  detour: {
    precise: boolean; // ★ false면 UI에서 "약 N km ▸"로 표시
    distanceM: number; // ΔD (m)
    durationS: number; // ΔT (s)
  };
  netSaving: number; // 원. 음수 가능
  estimatedCost: number; // Q × P_s
  scores: { balanced: number; minCost: number; minDistance: number };
  reason: string; // 템플릿 생성
}

interface SearchResult {
  searchId: string; // 익명. 딥링크 이벤트 연결용
  baseRoute: { distanceM: number; durationS: number; polyline: Point[] };
  expansion: {
    triggered: boolean;   // 최종 목록에 T3(d_perp > T2_MAX)가 남았는가
    finalRadiusM: number; // 최종 목록에 남은 T3의 최대 d_perp (없으면 T2_MAX)
  };
  referencePrice: number | null; // P_ref. A14면 null
  refPriceSource: RefPriceSource | null;
  candidates: Candidate[];
  warnings: Warning[];
}

interface Warning {
  code: "TIMEOUT" | "SHORT_ROUTE" | "NO_REFERENCE_PRICE";
  message: string;
}
```

> `expansion`은 "우회해서 넓혀 찾았다"는 결과 배너용 신호입니다. 회랑 bbox 쿼리가 T3까지
> 한 번에 덮으므로 별도 확장 단계는 없고, `triggered`는 최종 후보에 T3(`d_perp > T2_MAX`)가
> 남았는지로만 결정됩니다.

### 6.2 `POST /api/search` — SSE

**Request**

```json
{
  "origin": { "lat": 37.42, "lng": 127.12, "name": "성남시청" },
  "destination": { "lat": 37.88, "lng": 127.73, "name": "춘천역" },
  "fuel": "LPG",
  "filters": { "facilities": ["CAR_WASH"], "brands": [], "kpetroOnly": false, "selfOnly": false },
  "vehicle": { "efficiency": 8.5, "refuelAmount": 45, "timeValue": 200 },
  "mode": "balanced"
}
```

**Response** `Content-Type: text/event-stream`

| 이벤트       | 시점          | data                                                                      |
| ------------ | ------------- | ------------------------------------------------------------------------- |
| `progress`   | 단계 전환마다 | `{ step, radiusM? }` — `step`: `ROUTE`\|`COLLECT`\|`EXPAND`\|`PRECISE`    |
| `base_route` | STEP 1 직후   | `{ distanceM, durationS, polyline }` — 지도·헤더를 먼저 그림              |
| `partial`    | STEP 9 직후   | `{ candidates, referencePrice, refPriceSource, expansion }` — 추정치 결과 |
| `result`     | STEP 11 완료  | `SearchResult` 전체                                                       |
| `warning`    | 발생 시       | `Warning`                                                                 |
| `error`      | 치명적 실패   | `{ code, message }`                                                       |

```
event: progress
data: {"step":"ROUTE"}

event: base_route
data: {"distanceM":92000,"durationS":5640,"polyline":[...]}

event: progress
data: {"step":"EXPAND","radiusM":15000}

event: partial
data: {"candidates":[...],"referencePrice":1210,"refPriceSource":"SIGUNGU_AVG",
       "expansion":{"triggered":true,"finalRadiusM":6200}}

event: progress
data: {"step":"PRECISE"}

event: result
data: {"searchId":"...","baseRoute":{...},"candidates":[...]}
```

**`progress.radiusM`의 의미 — 헷갈리기 쉬움**

| 필드                       | 값                        | 의미                                                               |
| -------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `progress(EXPAND).radiusM` | `T3_MAX` = 15,000         | **지금 어디까지 뒤지는 중인가.** 후보 평가 전이라 실제 결과를 모름 |
| `expansion.finalRadiusM`   | 채택된 T3(geoTier)의 최대 `d_perp` | **어디서 찾았는가.** 결과 배너에 쓰는 값. 실측 우회로 배지가 바뀐 후보(§6.4)가 아니라 기하 티어 기준 |

두 값이 달라 보이는 것은 정상입니다. [`PRODUCT.md`](PRODUCT.md) §5.3 ②·§10.3.

> `partial`의 `expansion.finalRadiusM`은 STEP 9 시점 값이라 `result`와 다를 수 있습니다(STEP 11에서 `DETOUR_CAP_RATIO`·`MAX_RESULTS`로 후보가 빠지므로). **배너는 `result`를 받은 뒤 확정 렌더링하십시오.**

**클라이언트 규칙**

- `partial`로 받은 후보는 전부 `detour.precise === false`입니다. 반드시 `약 N km ▸`로 표시하십시오
- `result` 수신 후 목록 전체를 교체합니다. 사라지는 후보가 있을 수 있으며 정상입니다
- 스트림이 `error` 없이 끊기면 마지막 `partial`을 결과로 쓰고 "일부 계산이 완료되지 않았습니다"를 고지합니다
- **`EventSource`를 쓰지 마십시오.** POST를 쓸 수 없는 것도 문제지만, 진짜 이유는 **자동 재연결이 곧 파이프라인 재실행이고 그것이 오피넷 예산을 조용히 잠식**하기 때문입니다. `fetch` + `ReadableStream`으로 직접 제어합니다

### 6.2.1 JSON 폴백 — 인앱 브라우저 대응 ★

카카오톡·일부 삼성 인터넷 등 인앱 브라우저는 스트림을 버퍼링해 SSE를 무력화합니다. 최악은 사용자가 아무것도 받지 못하는 경우입니다.

**클라이언트 동작**

```
POST /api/search  (Accept: text/event-stream)
  → SSE_FIRST_EVENT_TIMEOUT_MS(3,000) 안에 첫 이벤트가 오지 않으면
  → 스트림 중단(AbortController)
  → 동일 요청을 Accept: application/json 으로 1회 재시도
  → 로딩 UI는 시간 기반 단계 표시로 전환 (실제 진행을 모르므로 EXPAND 문구는 쓰지 않음)
```

**서버 동작**

```ts
// 같은 서비스, 다른 출구 — 로직을 복제하지 마십시오
Accept: text/event-stream  → search(input, (e) => stream.write(sse(e)))
Accept: application/json   → search(input)            // 콜백 없음 = 완성 JSON
```

**응답 본문은 `result` 이벤트의 `data`와 동일한 `SearchResult`입니다.** 별도 타입을 만들지 마십시오.

| 규칙                                                                                   | 이유                                                                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 폴백은 **1회만** 재시도                                                                | 오피넷 예산이 두 배로 나가는 걸 막음. 캐시가 대부분 흡수하지만 보장은 아님                                               |
| 폴백 사용 여부를 익명 이벤트에 기록                                                    | 인앱 브라우저 비중을 측정해야 SSE 유지 여부를 판단할 수 있음 (§7.3)                                                      |
| `progress` 문구를 시간 기반으로 바꿀 때 **`EXPAND`(범위를 넓히는 중)는 표시하지 않음** | 실제로 확장이 걸렸는지 모르는 상태에서 그 문구를 띄우면 [`PRODUCT.md`](PRODUCT.md) §10.3이 금지한 "가짜 애니메이션"이 됨 |

### 6.3 `POST /api/detour` — 카드 탭 시 lazy 정밀 계산

```json
// Request
{ "origin": {...}, "destination": {...}, "stationId": "A0012345",
  "vehicle": { "efficiency": 8.5, "refuelAmount": 45, "timeValue": 200 },
  "priceStation": 1650, "referencePrice": 1210 }

// Response
{ "distanceM": 12400, "durationS": 1080, "precise": true, "netSaving": 3252,
  "polyline": [{ "lat": 37.42, "lng": 127.12 }, ...] }
```

카카오 경로 API 1회(경유 경로). 기본 경로는 `/api/search`에서 이미 캐시됐으므로 재호출이 아니라 캐시 히트입니다(§8 1시간 TTL). `ΔD`·`ΔT`는 0으로 클램프합니다.

**`priceStation` — Phase 8 구현 중 추가.** 이 엔드포인트는 오피넷을 다시 부르지 않으므로(카카오 호출만 예산에 잡혀 있음) 서버가 주유소의 현재 가격을 새로 알 방법이 없습니다. 클라이언트가 이미 화면에 들고 있는 `Candidate.price`를 그대로 넘겨받아 `netSaving`을 계산합니다.

**`polyline` — Phase 9 구현 중 추가.** 상세 화면(F8)이 "기본 경로(회색) + 경유 경로(강조)"를 지도에 그리려면 경유 경로의 폴리라인이 필요합니다. `recommendation-service` STEP 10은 정밀 계산 시 이미 이 폴리라인을 받아오면서도 거리·시간 델타만 뽑고 버렸는데, `/api/detour`는 그 값을 그대로 응답에 포함시킵니다. 기본 경로 폴리라인은 `/api/search` 결과(`SearchResult.baseRoute.polyline`)에 이미 있으므로 여기서 중복 전송하지 않습니다. 이미 정밀 계산된 후보라도 지도를 그리려면 폴리라인이 필요해 상세 화면은 진입 시 항상 이 엔드포인트를 호출합니다 — `getRoute`의 1시간 캐시 덕분에 대부분 카카오 재호출 없이 캐시 히트로 처리됩니다.

### 6.4 나머지 엔드포인트

| 메서드 · 경로                                    | 용도               | 응답                                                                                                    |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET /api/places/search?q=`                      | 장소 자동완성 (F1)     | `{ places: [{ name, address, lat, lng }] }` 최대 5건                                                    |
| `GET /api/stations/nearby?lat=&lng=&fuel=&sort=` | 내 주변 (F10)          | `{ stations: [...] }` 반경 `SEARCH_RADIUS`                                                              |
| `GET /api/stations/:id`                          | 상세 보강              | `Candidate`에서 경로 의존 필드(`tier`·`perpDistanceM`·`detour`·`netSaving`·`scores`·`reason`)를 뺀 형태 |
| `POST /api/events/navi`                          | 딥링크 클릭 기록       | `204`                                                                                                   |
| `GET /api/cron/import-prices`                    | 유가 CSV 임포트 (§9.3) | `200 { status, pricedOn, ... }` — 실패도 200                                                            |
| `GET /api/cron/backfill-details`                 | 시설 정보 백필 (§9.3)  | `200 { limit, picked, updated, notFound, failed, remaining }`                                           |

```json
// POST /api/events/navi
{
  "searchId": "...",
  "app": "KAKAO",
  "rank": 1,
  "tier": "T3",
  "netSaving": 3252,
  "detourDistanceM": 12400
}
```

**크론 라우트 인증**

`/api/cron/*`는 `Authorization: Bearer ${CRON_SECRET}` 헤더를 검증하고, 불일치면 `401`.
각 라우트는 서비스 함수(`price-import-service` / `detail-backfill-service`)를 호출하며,
같은 함수를 `pnpm data:*` 스크립트도 씁니다 — 로직을 복제하지 마십시오.

---

## 7. DB Schema (PostgreSQL)

> **테이블·컬럼 이름을 `gas_station`/`oil_type`처럼 좁게 만들지 마십시오.** `refuel_point`/`energy_type`을 유지합니다. 향후 전기차 충전소 확장 시 마이그레이션을 피하기 위한 **의도적 일반화**입니다. 이유는 [`PRODUCT.md`](PRODUCT.md) §2.3.

### 7.1 `refuel_point` — 주유소 마스터

정본은 `src/infra/db/schema.ts` + `drizzle/` 마이그레이션입니다. 아래는 형태 요약이며,
세 소스가 각자 자기 컬럼만 씁니다 (컬럼 소유권 규칙 — MIGRATION-DB.md §6).

```sql
CREATE TABLE refuel_point (
  id              TEXT PRIMARY KEY,          -- 오피넷 UNI_ID = 유가 CSV `번호`
  name            TEXT        NOT NULL,      -- ┐
  brand_code      TEXT        NOT NULL,      -- │ CSV 소유
  energy_type     TEXT        NOT NULL,      -- │ 'OIL' | 'LPG' | 'BOTH' (LPG_YN: Y=LPG전용 / C=겸업)
  address_road    TEXT,                      -- │
  address_jibun   TEXT,                      -- │
  sigun_cd        TEXT,                      -- │ `지역` 텍스트 → SIGUNCD 매핑 (P_ref 집계 키)
  is_self         BOOLEAN,                   -- │ CSV 셀프여부. NULL=미상
  price_gasoline  INTEGER,  price_diesel INTEGER,  price_lpg INTEGER,   -- │ 유종별 최신 스냅샷
  price_premium   INTEGER,  price_kerosene INTEGER,                     -- │ (적재만, UI 미노출)
  priced_on       DATE,                      -- │ CSV 기준일자
  last_seen_on    DATE,                      -- ┘ 마지막으로 CSV에 등장한 날 (폐업 감지)

  lat             DOUBLE PRECISION NOT NULL, -- ┐ 지오코딩 소유 (비어 있을 때만 채움)
  lng             DOUBLE PRECISION NOT NULL, -- │ WGS84. 오피넷 실좌표 있으면 그대로 유지
  coord_source    TEXT,                      -- ┘ 'OPINET' | 'KAKAO_ADDR' | 'KAKAO_KEYWORD'
  katec_x         DOUBLE PRECISION,  katec_y DOUBLE PRECISION,

  has_car_wash    BOOLEAN NOT NULL DEFAULT FALSE,  -- ┐ 상세 API 소유 (백필 크론)
  has_maintenance BOOLEAN NOT NULL DEFAULT FALSE,  -- │
  has_cvs         BOOLEAN NOT NULL DEFAULT FALSE,  -- │
  is_kpetro       BOOLEAN NOT NULL DEFAULT FALSE,  -- │
  tel             TEXT,                            -- │
  detail_synced_at TIMESTAMPTZ,                    -- ┘ NULL = 시설 정보 미확인

  last_price INTEGER,  last_price_prod TEXT,  price_traded_at TIMESTAMPTZ,  -- 레거시(상세 API 경로)
  source          TEXT        NOT NULL,      -- 'OPINET_CSV' | 'OPINET' | 'STANDARD_DATA'(미사용)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refuel_point_sigun  ON refuel_point (sigun_cd);
CREATE INDEX idx_refuel_point_energy ON refuel_point (energy_type);
CREATE INDEX idx_refuel_point_latlng ON refuel_point (lat, lng);   -- 회랑 bbox 쿼리
CREATE INDEX idx_refuel_point_seen   ON refuel_point (last_seen_on);
```

보조 테이블: `refuel_point_staging`(임포트 스테이징), `csv_import_log`(임포트 이력·G3·G4 참조·
기준일자 배너) — MIGRATION-DB.md §5.2·§7.

**마스터 구축 전략**

- **가격·상표·주소·셀프여부**는 오피넷 정보마당 **"과거 판매가격" CSV**로 채웁니다
  (`source='OPINET_CSV'`). CSV `번호` = `UNI_ID`라 `refuel_point.id`에 직접 조인됩니다.
  좌표는 CSV에 없어 카카오 지오코딩으로 조달합니다.
- **시설 정보**(세차·정비·편의점·KPETRO·전화)는 CSV에 없어 오피넷 상세 API로
  백그라운드 백필합니다 (`upsertRefuelPointFromDetail` 계열, `detail_synced_at`만 갱신).
- **행안부 표준데이터는 쓰지 않습니다** — `verify:standard-data` 결과 `UNI_ID`·시설
  컬럼이 없고 도로명주소 매칭 커버리지가 42%에 그칩니다. `import-standard-data.ts`도
  만들지 않습니다.

### 7.2 `P_ref` 폴백 — `refuel_point` 실시간 집계

`P_ref`(기준가)는 T1+T2 후보의 중앙값을 우선 씁니다. 후보가 `P_REF_MIN_BASE` 미만이면
시군구→시도→전국 순으로 폴백하며, 각 단계 평균은 `refuel_point`에서 그때그때 집계합니다:

```sql
SELECT round(avg(price_gasoline)) FROM refuel_point
 WHERE sigun_cd = :sigunCd AND price_gasoline > 0;
```

`findSigunguAvgPrice` / `findSidoAvgPrice` / `findNationalAvgPrice`(`infra/db/repositories.ts`)가
담당하며, 요청 경로의 외부 API 호출은 0입니다. 별도 집계 테이블·동기화 배치는 없습니다.

### 7.3 익명 이벤트 로그

**개인 식별 가능 정보를 저장하지 않습니다.** 좌표는 반드시 2km 격자로 스냅한 뒤 저장합니다. 정책은 [`PRODUCT.md`](PRODUCT.md) §11.2.

> 이 두 테이블과 기록 로직은 **Phase 11 범위이며 아직 구현하지 않았습니다** — `event-service`는
> 현재 스텁입니다. 아래는 목표 스키마입니다.

```sql
CREATE TABLE search_event (
  id                  UUID PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  fuel                TEXT    NOT NULL,
  filters             JSONB   NOT NULL,
  origin_cell         TEXT    NOT NULL,   -- 2km 격자 스냅
  dest_cell           TEXT    NOT NULL,
  base_distance_m     INTEGER NOT NULL,
  base_duration_s     INTEGER NOT NULL,
  t1_count            SMALLINT NOT NULL,
  t2_count            SMALLINT NOT NULL,
  t3_count            SMALLINT NOT NULL,
  expansion_triggered BOOLEAN NOT NULL,   -- 최종 목록에 T3(d_perp > T2_MAX)가 남았는가
  final_radius_m      INTEGER NOT NULL,
  reference_price     INTEGER,
  ref_price_source    TEXT,
  route_calls         SMALLINT NOT NULL,
  duration_ms         INTEGER NOT NULL,
  warnings            TEXT[]
);

CREATE TABLE navi_click_event (
  id                UUID PRIMARY KEY,
  search_id         UUID REFERENCES search_event(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  app               TEXT     NOT NULL,    -- 'KAKAO' | 'NAVER' | 'TMAP'
  rank              SMALLINT NOT NULL,
  tier              TEXT     NOT NULL,
  net_saving        INTEGER,
  detour_distance_m INTEGER
);

CREATE INDEX idx_search_event_created ON search_event (created_at);
CREATE INDEX idx_search_event_expand  ON search_event (expansion_triggered, created_at);
```

**지표 산출**

```sql
-- T3 발동률
SELECT avg(CASE WHEN t3_count > 0 THEN 1.0 ELSE 0 END) FROM search_event;

-- T3 발동/미발동 검색의 내비 연결률 비교
SELECT s.t3_count > 0 AS has_t3,
       count(DISTINCT n.search_id)::float / count(DISTINCT s.id) AS click_rate
FROM search_event s LEFT JOIN navi_click_event n ON n.search_id = s.id
GROUP BY 1;
```

---

## 8. 캐시 전략 (Redis)

모든 키에 `REDIS_KEY_PREFIX`(`dev`/`prod`)를 접두사로 붙입니다.

| 대상              | 키                                        | TTL   | 근거                     |
| ----------------- | ----------------------------------------- | ----- | ------------------------ |
| 경로 (기본/경유)  | `route:{originGrid}:{destGrid}:{viaGrid?}` | 1시간 | 교통 상황 반영           |
| 장소 검색         | `place:{query}`                           | 24시간 | 거의 안 변함            |
| 지역→SIGUNCD 매핑 | `opinet:sigun-map`                        | 30일  | CSV 임포트용 (§5.1)      |

### 8.1 가격·마스터·시설 정보는 캐시하지 않습니다

전부 `refuel_point`에서 직접 읽습니다. 가격은 일 1회 CSV 임포트가, 시설 정보는 백필
크론이 갱신하므로 Redis에 둘 이유가 없습니다. 신선도는 `priced_on`(날짜)으로 표시합니다.

### 8.2 격자 스냅

캐시 히트율을 올리기 위해 좌표를 2km 격자로 스냅해 키를 만듭니다. 같은 격자 스냅 함수를 **익명 로깅에도 재사용**합니다 (§7.3).

### 8.3 avoidHighway는 캐시 키의 일부입니다

`routeKey`의 마지막 인자가 `avoidHighway`입니다 (Phase 12). 회피를 켜고 끈 결과는
origin/destination/waypoint가 같아도 완전히 다른 경로라 키를 분리해야 합니다 — 빠뜨리면
회피를 켠 사용자가 끈 사용자의(또는 그 반대) 캐시된 경로를 그대로 받습니다. §6.3 회귀
(경유지 2km 격자 공유 버그)와 같은 종류의 실수입니다.

---

## 9. Data Flow

### 9.1 검색 (핵심 흐름)

```
Client
  │ POST /api/search (SSE 개방)
  ▼
recommendation-service
  │   ═══▶ SSE: progress(ROUTE)
  ├─▶ route-service ──▶ [cache] ──▶ 카카오 길찾기        ── STEP 1
  │      └─ R₀ (D_base, T_base, polyline)
  │   ═══▶ SSE: base_route
  │
  │   ═══▶ SSE: progress(COLLECT)
  ├─▶ station-service.collectStations                    ── STEP 2·3
  │      ├─ 폴리라인 투영 → bbox(회랑) + T3_MAX 마진
  │      ├─ refuel_point WHERE lat/lng BETWEEN … AND price_{fuel} > 0
  │      │                  AND last_seen_on >= today - 7d   (외부 호출 없음)
  │      └─ 필터 적용 (시설·브랜드·품질인증·셀프여부)
  │
  ├─▶ domain/tier (d_perp 계산 · T3_MAX 초과 제거)        ── STEP 4
  │      회랑 쿼리가 T1~T3를 한 번에 덮으므로 별도 확장 단계 없음
  │
  ├─▶ price-service.computeReferencePrice                 ── STEP 7
  │      └─ T1+T2 ≥ P_REF_MIN_BASE ? median
  │         : refuel_point 시군구→시도→전국 avg(price) 가중평균
  │
  ├─▶ domain/pricing (T3 게이트)                          ── STEP 8
  │
  ├─▶ 정밀 계산 대상 선정 (모드별 상위 합집합 → MAX_PRECISE) ── STEP 10a
  │      이후 파이프라인은 이 집합만 다룬다 — partial과 result의 구성원이 같아진다
  │      ※ 최종 후보에 T3(d_perp > T2_MAX)가 남으면 progress(EXPAND) 방출
  │
  ├─▶ domain/pricing 1차 스코어링                         ── STEP 9
  │   ═══▶ SSE: partial  (추정치 결과 — precise:false)
  │
  │   ═══▶ SSE: progress(PRECISE)
  ├─▶ route-service 병렬 경유 경로 (MAX_PRECISE개 전량)     ── STEP 10b
  │
  ├─▶ domain/pricing 재계산 · 배지 재판정 · CAP 제거 · 정렬 · reason  ── STEP 11
  │      정렬 1차 키는 detour.precise — 실측군이 추정군보다 항상 위
  │   ═══▶ SSE: result
  │
  └─▶ event-service.logSearch (비동기 · Phase 11 스텁)
```

### 9.2 딥링크 클릭

```
Client → domain/deeplink.build(app, origin, station, destination)
       → 스킴 실행 (+ 폴백 타이머)
       → POST /api/events/navi  (fire-and-forget)
```

### 9.3 배치

| 주기          | 실행 경로                                        | 하는 일                                                              |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| 매일 05:00 KST | GitHub Actions → Playwright 스크래핑 → Vercel Blob | 오피넷 유가 CSV 2개 다운로드 (NetFunnel 게이트, MIGRATION-DB.md §7 Phase D) |
| 매일 05:40 KST | Vercel Cron → `GET /api/cron/import-prices`     | Blob CSV → 게이트 G1~G8 → 지오코딩 → 스테이징 → `refuel_point` 원자적 스왑 |
| 매일 06:00 KST | Vercel Cron → `GET /api/cron/backfill-details`  | `detail_synced_at IS NULL`인 주유소 ≤280곳 상세 API로 시설 정보 백필 |
| 수동          | `pnpm data:import-csv` / `data:backfill-details [--status]` | 마스터 1회성 재구축 / 백필 수동 실행·현황 확인               |

**cron 라우트와 스크립트는 같은 서비스 함수를 호출합니다.** 로직을 복제하지 마십시오 —
임포트는 `price-import-service.ts`, 백필은 `detail-backfill-service.ts`, 파싱·게이트·지오코딩은
`infra/csv`·`infra/geocode`를 라우트와 스크립트가 공유합니다.

`P_ref` 시군구·시도·전국 평균은 `refuel_point`에서 그때그때 집계하므로 별도 동기화 배치가 없습니다 (§7.2).

---

## 10. 개발 순서 — Phase

**주차가 아니라 의존성으로 끊었습니다.** 각 Phase는 앞 Phase의 완료 기준이 충족되어야 시작할 수 있습니다.

> **전 Phase 공통 완료 기준: 코드 + 해당 테스트 + 문서 갱신.** 셋 중 하나라도 빠지면 그 단계는 끝난 것이 아닙니다.

> 아래는 최초 구축 순서 기록입니다. 이후 **유가 CSV 데이터 전환**(MIGRATION-DB.md, Phase A~E)이
> Phase 3(오피넷 반경검색)·6(시군구 평균가)·7(확장 수집·`P_ref`)의 상당 부분을 교체했습니다 —
> 검색 데이터 경로의 현재 정본은 MIGRATION-DB.md입니다. 나머지(도메인 계산·좌표계·딥링크·프론트)는
> 그대로 유효합니다.

---

### Phase 0 — 사전 검증 + 픽스처 저장

|          |                                                     |
| -------- | --------------------------------------------------- |
| **목적** | 아키텍처·스키마·파라미터를 좌우하는 미지수 제거     |
| **선행** | 오피넷·카카오 키 보유                               |
| **범위** | 검증 스크립트 4개 + 픽스처. **앱 코드는 쓰지 않음** |

| 작업                   | 확인 항목                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| `verify:coord`         | ③ KATEC ↔ WGS84 왕복 오차                                                |
| `verify:standard-data` | ② 표준데이터 좌표·시설 컬럼 + **오피넷 `UNI_ID` 조인 키**                |
| `verify:price-time`    | ⑪ 반경검색 응답에 **가격 기준시각이 오는가**                             |
| `verify:upstash`       | ⑬ Upstash 무료 티어 일일 명령 수 한도                                    |
| **픽스처 저장**        | 오피넷 반경검색·상세, 카카오 경로·로컬의 실제 응답을 `tests/fixtures/`에 |

**완료 기준**

- 좌표 왕복 오차 50m 이내. 초과 시 `towgs84` 재조정까지 완료
- 조인 키 존재 여부 확정 → **마스터 DB 전략 확정** (없으면 §7.1을 상세 API 방식으로 되돌림)
- 기준시각 취득 경로 확정 → 안 오면 **오피넷 갱신 스케줄 기반 근사**로 전환하고 §5.1·[`PRODUCT.md`](PRODUCT.md) §6.3 갱신
- 픽스처 4종 저장

> **실행 순서 주의.** 스크립트를 돌리려면 최소한의 TS 실행 환경이 필요합니다. **Phase 1의 "저장소 + TS + tsx" 부분만 먼저 하고** Phase 0을 돌린 뒤, 나머지 Phase 1을 마저 진행하십시오.

**연결** — ②③⑪ 결과가 `domain/types.ts`와 DB 스키마를 결정합니다. 건너뛰면 Phase 2와 6을 두 번 씁니다.

---

### Phase 1 — 초기화 + 규칙 집행 장치

|          |                                                                |
| -------- | -------------------------------------------------------------- |
| **목적** | 이후 모든 코드가 규칙 안에서 쓰이도록 **울타리를 먼저 친다**   |
| **선행** | Phase 0                                                        |
| **범위** | 프로젝트 골격 · 린트 경계 규칙 · CI · `params.ts` · `types.ts` |

**주요 작업**

- Next.js(App Router) + TS + Tailwind + shadcn 4개 + pnpm
- **ESLint 레이어 경계 규칙** ([`../AGENTS.md`](../AGENTS.md) §17.1)
- Vitest + MSW 세팅, Phase 0 픽스처 연결
- CI(GitHub Actions): 타입 체크 · 린트 · 테스트 → **PR 머지 조건**
- `domain/params.ts` (값의 정본은 [`PRODUCT.md`](PRODUCT.md) §9), `domain/types.ts` (좌표 3종을 **서로 대입 불가한 브랜드 타입**으로)

**완료 기준 — 역테스트로 확인**

- `domain/`에서 `fetch`를 import하는 코드를 만들면 **린트가 실패한다**
- `WGS84Point`를 `KatecPoint` 자리에 넣으면 **컴파일이 실패한다**
- CI가 실패하면 **머지가 막힌다**

**연결** — 이 울타리가 없으면 Phase 2에서 순수성이 조용히 깨지고, 나중에 잡으려면 전면 리팩터링입니다.

---

### Phase 2 — domain 순수 계산 + 단위 테스트 ★

|          |                                                                  |
| -------- | ---------------------------------------------------------------- |
| **목적** | **제품 신뢰도의 근간.** 여기가 틀리면 나머지가 전부 무의미       |
| **선행** | Phase 1                                                          |
| **범위** | `geo` → `tier` → `pricing` → `cache-ttl` → `reason` → `deeplink` |

**이 순서인 이유** — `tier`는 `geo`의 `d_perp`를, `pricing`은 `tier` 분류를, `reason`은 `pricing` 결과를 씁니다. 역순으로 만들면 목을 만들어야 합니다.

**완료 기준**

- `domain/` 커버리지 90% 이상
- 좌표 왕복 오차가 **Phase 0 실측값과 일치**
- `d_perp`가 **선분** 기준임을 검증하는 케이스 포함 (꼭짓점 기준 구현이면 실패하는 테스트)
- `netSaving` 경계값 — 음수 / `P_ref` 폴백 단계 전부 / 후보 0·1개
- `reason` 템플릿 6분기 전부
- [`PRODUCT.md`](PRODUCT.md) §5.3의 검산 표를 **골든 테스트로 그대로** 사용

---

### Phase 3 — infra: 오피넷

|          |                                                    |
| -------- | -------------------------------------------------- |
| **목적** | 예산을 지키면서 외부 데이터를 도메인 타입으로 변환 |
| **선행** | Phase 2 (KATEC 변환), Phase 0 (픽스처)             |
| **범위** | `katec` · `client` · `mapper` · `budget` · `cache` |

**주요 작업** — `proj4` KATEC 변환 → 타임아웃·재시도·동시성 제한 클라이언트 → zod 스키마 + mapper → Upstash `INCRBY` 예산 카운터 → 격자 스냅 키 + 동적 TTL 캐시(§8.1)

**완료 기준**

- 픽스처가 zod 스키마를 통과
- **예산 카운터가 상한에서 정확히 막는다** — 동시 호출 포함 테스트
- `UNI_ID`·`OS_NM` 등 원본 필드명이 `infra/opinet/` 밖으로 나가지 않음
- 캐시 히트 시 외부 호출 0회

---

### Phase 4 — infra: 카카오

|          |                                                 |
| -------- | ----------------------------------------------- |
| **목적** | 경로 탐색과 장소 검색                           |
| **선행** | Phase 2, Phase 0                                |
| **범위** | `mobility`(경유지 0~1개) · `local`(키워드 검색) |

**완료 기준** — 픽스처 파싱 테스트 / 경유지 유무 두 경로 / 폴리라인 정규화 / 경로 캐시 동작

---

### Phase 5 — 실측 → 파라미터 확정 ★

|          |                                                              |
| -------- | ------------------------------------------------------------ |
| **목적** | 미확정 파라미터를 **데이터로 확정**                          |
| **선행** | Phase 2·3·4 — 도메인 계산 + 두 클라이언트가 있어야 측정 가능 |
| **범위** | 스크립트 3개. 앱 코드 아님                                   |

**왜 여기인가** — 파라미터가 미확정인 채로 파이프라인을 만들면, 값이 바뀔 때 파이프라인과 테스트를 다시 손봐야 합니다. 실측에 필요한 건 도메인 계산과 두 클라이언트뿐이므로 Phase 7보다 먼저 하는 것이 맞습니다.

| 스크립트              | 확정할 것                                            |
| --------------------- | ---------------------------------------------------- |
| `verify:coverage` (⑫) | 회랑 bbox 수집이 전수 스캔 대비 후보를 누락하지 않는가 |
| `verify:t3-rate`      | **T3 발동률·게이트 통과율**                          |
| `verify:uturn` (④)    | `DETOUR_ESTIMATE_FACTOR` + 경로 API의 유턴 반영 여부 |
| `verify:detour` (⑭)   | `DETOUR_TIME_CAP_RATIO` + 실측 `ΔT` 분포·`ΔD=0` 비율 (Phase 10에 추가) |

> **`verify:coverage`·`verify:t3-rate`·`verify:uturn` 셋은 회랑 bbox 전환(§7 Phase C) 뒤
> 한동안 제거된 `SAMPLE_INTERVAL`·`OFFSET`·`MIN_CANDIDATES`를 계속 import해서 모듈 로드
> 단계에서 죽는 상태였습니다(`tsconfig.json`이 `scripts/`를 제외해 `pnpm typecheck`에
> 잡히지 않았습니다). **2026-09-08에 되살렸습니다** — 오피넷 반경검색(`fetchStationsAtKatecPoint`
> + `samplePolyline`/`normalOffsets` 샘플링)을 걷어내고 검색 파이프라인과 같은
> `station-service.collectStations`(회랑 bbox, DB 쿼리)로 후보를 모으도록 다시 썼습니다.
> `MIN_CANDIDATES`·확장 수집 로직은 되살리지 않았습니다 — 회랑 bbox가 `T3_MAX`까지 한
> 번에 덮어 그 개념 자체가 없어졌기 때문입니다(§7 Phase C). `verify:coverage`는 측정
> 대상도 함께 바뀌었습니다: "샘플 간격이 후보를 놓치는가"는 지금 구조에서 성립하지
> 않는 질문이라(⑫는 이미 §12에서 "해결됨"), 대신 "`station-service`의 bbox 계산이
> 전수 스캔 대비 후보를 누락하는가"를 검증합니다.
>
> 세 스크립트 모두 이제 오피넷을 전혀 호출하지 않으므로(후보 조회가 `refuel_point` DB
> 쿼리 하나로 끝남) 예전의 오피넷 예산 보호 장치(`confirmBudget`·`--yes` 게이트)는
> 제거했습니다 — 남은 카카오 호출(스크립트당 1~7회)은 일 10,000건 쿼터 안에서 무시할
> 수준입니다(`verify:detour`와 같은 관례).

**완료 기준**

- 파라미터 확정 → `params.ts` 반영 → [`PRODUCT.md`](PRODUCT.md) §9.1 갱신
- **LPG T3 발동률이 20% 미만이면 개발을 멈추고 기획 재검토 안건을 제기** ([`PRODUCT.md`](PRODUCT.md) §11.3)
- 유턴 미반영이면 대안 논의 후 진행

---

### Phase 6 — DB + 마스터 구축

|          |                                                                          |
| -------- | ------------------------------------------------------------------------ |
| **목적** | **시설 필터 N+1 제거** + `P_ref` 폴백 확보                               |
| **선행** | Phase 0 ② (조인 키 확인)                                                 |
| **범위** | Drizzle 스키마 · 마이그레이션 · `refuel_point` upsert/조회 · 시군구 평균가 동기화(오피넷 `avgSigunPrice.do`/`areaCode.do` → `sigungu_avg_price`) — 표준데이터 임포트는 폴백 C 채택으로 **범위 밖** (§7.1) |

**완료 기준 — 완료 (2026-08-31)**

- 임포트 후 `UNI_ID`로 오피넷 응답과 **조인 성공** — `upsertRefuelPointFromDetail` → `findRefuelPointsByIds` 라운드트립을 실제 오피넷 상세 API + Neon(dev)으로 검증
- 시설 컬럼이 채워짐 → **시설 필터의 상세 조회 호출이 0으로 떨어짐** — 컬럼·리포지토리까지 준비됨. 반경검색 결과와의 조인 자체는 station-service(Phase 7) 몫
- 테이블·컬럼이 `refuel_point`/`energy_type` 등 일반 개념 유지 (§9 변경 원칙)
- cron 인증 동작 (`CRON_SECRET`) — `POST /api/cron/sync-sigungu`, `Authorization` 불일치 시 401
- `sigungu_avg_price`는 실제 오피넷 API(시도 16개 순회)로 동기화 검증 — 682행 upsert 확인

`search_event`/`navi_click_event`(§7.3)는 Phase 6 범위가 아닙니다 — Phase 11에서 만듭니다.

---

### Phase 7 — services 파이프라인

|          |                                                          |
| -------- | -------------------------------------------------------- |
| **목적** | STEP 1~11 전체 오케스트레이션                            |
| **선행** | Phase 2·3·4·5·6 전부                                     |
| **범위** | `route` · `station` · `price` · `recommendation-service` |

**완료 기준 — MSW 통합 테스트 4경로 — 완료 (2026-08-31)**

1. 확장 미발동 (T1+T2 충분)
2. 확장 발동
3. **예산 소진** → `skippedReason: "QUOTA"` / 기본 수집까지 소진 시 즉시 안내
4. 부분 실패 → 성공 구간으로 진행 + `warning`

추가로 **`onProgress` 콜백이 각 STEP에서 방출되는지**, 그리고 **콜백 없이 호출해도 동일한 `SearchResult`가 나오는지** 확인합니다 (§6.2.1 폴백의 전제).

**구현 중 발견 — `domain/types.ts`가 §6.1 API Contract와 어긋나 있었음.** `SearchResult`에 `searchId`가 없고 `referencePrice`/`refPriceSource`가 non-null이었으며 `warnings`가 `string[]`(§6.1의 `Warning{code,message}[]`가 아님)이었고, `SearchInput.filters`엔 `kpetroOnly`가 없었습니다. Phase 2 당시 API Contract가 확정되기 전에 먼저 작성된 코드가 이후 갱신을 반영하지 못한 것으로 보입니다. AGENTS.md §1 원칙("코드와 문서가 다르면 코드를 고치는 것이 기본")에 따라 `domain/types.ts`를 §6.1에 맞게 수정했습니다 — 이 타입을 참조하는 코드가 아직 없어 다른 곳에 영향은 없었습니다.

**`route-service`/`station-service`의 캐시·예산 접근은 `RedisLike` 인터페이스로 주입받습니다**(기본값 `getRedis()`) — `opinet/budget.ts`의 `BudgetStore` 주입 패턴과 동일한 이유(테스트 용이성)입니다. `price-service`는 PRODUCT.md §8의 "시군구 가중평균"(시군구→시도→전국 폴백)을 구현하기 위해 `db/repositories.ts`에 `findSidoAvgPrice`·`findNationalAvgPrice`를 추가했습니다.

---

### Phase 8 — API 계층

|          |                                                   |
| -------- | ------------------------------------------------- |
| **목적** | SSE + JSON 폴백 경계                              |
| **선행** | Phase 7                                           |
| **범위** | `/api/search` · `/api/detour` · 나머지 엔드포인트 |

**완료 기준 — 완료 (2026-08-31)**

- **이벤트 순서 계약 테스트** — `base_route` 최초, `result` 최종, `error` 이후 무발신
- `Accept: application/json` 요청이 **SSE의 `result`와 동일한 본문**을 반환 — 같은 `SearchResult`를 양쪽 경로에 흘려 직접 비교하는 테스트로 확인
- `maxDuration` 설정 (`/api/search` 20초, `/api/detour` 10초)
- route handler에 비즈니스 로직 없음 (파싱 → 서비스 → 직렬화) — 변환 로직은 `src/app/api/_lib/{schema,validate,serialize,sse}.ts`에 분리

**구현 중 발견 ① — `src/lib/api/`는 이미 예약된 이름이었음.** §2 폴더 구조에 `src/lib/api/`가 Phase 9의 클라이언트 fetch 훅(`useSearchStream.ts` 등) 자리로 정의돼 있어, 이번에 만든 서버 전용 스키마·직렬화·SSE 유틸은 `src/app/api/_lib/`(Next.js가 라우팅에서 제외하는 `_` 접두사 폴더)에 두었습니다. `src/lib/api/`는 계속 Phase 9 몫으로 비워둡니다.

**구현 중 발견 ② — `POST /api/detour`에 `priceStation` 필드를 추가함.** §6.3 문서 예시에는 없었지만, 이 엔드포인트는 오피넷을 재조회하지 않아 서버가 주유소 가격을 새로 알 방법이 없습니다. 클라이언트가 이미 보고 있는 `Candidate.price`를 그대로 받아 `netSaving`을 계산하도록 요청 스키마에 반영했습니다(위 §6.3 예시 갱신).

---

### Phase 9 — 프론트 핵심 흐름

|          |                                                         |
| -------- | ------------------------------------------------------- |
| **목적** | 홈 → 결과 → 상세                                        |
| **선행** | Phase 8                                                 |
| **범위** | Zustand 스토어 · `lib/api` 훅 · 화면 3개 · 카카오맵 SDK |

**완료 기준 — UI 불변식 8개 체크리스트 — 완료 (2026-08-31)** ([`../AGENTS.md`](../AGENTS.md) §6)

확장 고지 배너 / 가격 기준시각 / `오래된 정보` 배지 / 계산 전제 표시 / 면책 문구 / T3 전화 확인 / 티맵 안내 / 후보 0건 대안

추가로

- 모드 탭 전환 시 **API 재호출 0회**
- 연비·주유량 수정 시 즉시 재계산, `persist` 저장
- **추정치와 실측치가 시각적으로 구분됨** (`약 N km ▸`)
- 스토어가 빈 상태로 `/station/:id` 직접 진입 시 "검색 컨텍스트 없음" 화면

**구현 중 발견 — `Candidate.priceUpdatedAt`이 항상 비어 있었음.** "가격 기준시각" 표시(§6.1, 위 불변식)는 이 필드에 의존하는데, Phase 7 `recommendation-service.finalizeCandidates`가 이 필드를 채우지 않고 있었습니다(옵셔널이라 타입 오류로도 드러나지 않음). `domain/cache-ttl.approximateLastUpdateTime(now)`(Phase 2에 이미 존재 — 오피넷이 실제 기준시각을 안 줄 때의 근사치)를 채우도록 고쳤습니다.

**구현 중 발견 — Upstash Redis 클라이언트의 자동 역직렬화가 캐시 전체를 깨뜨리고 있었음(심각).** 실제 `OPINET_CERT_KEY`·`KAKAO_REST_API_KEY`·`DATABASE_URL`을 채운 뒤 브라우저에서 실제 검색을 돌려보고서야 발견됨 — 그 전까지 모든 테스트는 `fakeRedis()` 목(mock)으로만 검증돼 이 버그를 잡을 수 없었습니다.

`@upstash/redis`의 `Redis` 클라이언트는 기본값(`automaticDeserialization: true`)으로 `get()`이 JSON처럼 보이는 문자열을 자동으로 파싱해 객체로 돌려줍니다. 그런데 `route-service.ts`(`deserialize`)와 `station-service.ts`가 저장한 JSON 문자열을 **직접 `JSON.parse`** 하도록 짜여 있어(Phase 7), 이미 객체로 돌아온 값을 다시 파싱하려다 `SyntaxError: "[object Object]" is not valid JSON`로 검색 전체가 실패했습니다. `infra/cache/redis.ts`에서 `automaticDeserialization: false`로 꺼서 `get()`이 항상 원본 문자열을 반환하도록 고쳤습니다 — `route-service`·`station-service`·단위 테스트의 `fakeRedis()` 전부가 원래 전제하던 계약과 일치시킨 것입니다.

**구현 중 발견 — `PlaceAutocompleteInput`이 부모가 바깥에서 값을 바꿔도 반영 안 함.** "현재 위치" 버튼과 최근 검색 클릭이 스토어의 `origin`/`destination`을 바꿔도 입력창에 표시되는 텍스트는 그대로였습니다 — 컴포넌트 내부 `query` state를 `useState(value?.name ?? "")`로 마운트 시 한 번만 초기화하고 이후 `value` prop 변화를 반영하지 않았기 때문입니다. React 공식 권장 패턴인 "렌더링 중 상태 조정"(이전 값과 비교해 렌더 중에 `setState`)으로 고쳤습니다 — `useEffect` 안에서 `setState`를 부르는 것보다 리렌더 한 번을 아낄 수 있고, 이 프로젝트의 `react-hooks/set-state-in-effect` 린트 규칙도 피합니다.

**구현 중 발견 — 짧은 경로에서 `DETOUR_CAP_RATIO`가 우회 후보를 전부 걸러냄(알고리즘 설계 갭).** 사용자가 실제 짧은 경로(남한산성입구역 → 을지대학교, 기본 경로 2km)로 검색해보고 발견함. `domain/pricing.exceedsDetourCap`은 우회가 `D_base × 0.5`를 넘으면 후보를 제외하는데(§7.2 STEP 11 ③, PRODUCT.md §10.1 A6), 이 규칙은 장거리 여행(92km 예시 — cap이 46km)을 전제로 설계되어 있었습니다. 기본 경로가 2km면 cap이 1km가 되어, 실제로 우회할 가치가 있는 T3 후보(예: 몇 km 밖의 LPG 충전소)까지 전부 제외됐습니다. `baseDistanceM < MIN_ROUTE_DISTANCE`(20km, 이미 `SHORT_ROUTE` 경고 기준으로 쓰던 값)면 이 cap을 적용하지 않도록 고쳤습니다 — `T3_MAX`(우회 탐색 상한 15km)와 `NetSaving > 0` 게이트가 이미 "어느 정도 범위"를 제한하므로 cap 없이도 무한정 찾아주지는 않습니다. `PRODUCT.md` §9.1·§10.1·§7.2 STEP11을 함께 갱신했습니다.

**의도적으로 범위를 좁힌 것들 — 정직하게 미룸**

- **F10(내 주변)은 이번 Phase에서 빠짐.** PRODUCT.md §5.6이 "여기에 시간을 많이 쓰지 말라"고 명시한 대로, `useNearbyStations` 훅과 `/nearby` 화면은 다음으로 미룹니다. `GET /api/stations/nearby`는 Phase 8에서 이미 만들어져 있습니다.
- **A2(필터 때문에 0건) 진단을 단순화함.** PRODUCT.md §5.2는 "어떤 필터가 원인인지 특정"하라고 하지만, 이는 필터를 하나씩 빼며 재검색해야 해 오피넷 예산을 추가로 씁니다. 지금은 활성 필터가 있으면 "필터 초기화하고 다시 찾기" 하나만 제시합니다 — 원인 필터를 짚어주지는 않습니다.
- **A1(확장해도 0건) 시 "목적지·출발지 근처 검색 제안"은 구현 안 함.** `/nearby`가 없어 제안할 화면 자체가 없습니다 — F10을 만들 때 같이 연결해야 합니다.
- **딥링크 미설치 폴백(폴백 타이머 → 스토어 이동)은 만들지 않음.** ARCHITECTURE.md 자체가 이를 Phase 10 범위로 분리해뒀습니다 — 이번엔 스킴 링크(`kakaomap://`, `nmap://`, `tmap://`)만 연결했습니다.
- **네이버지도 `appname` 값은 `"oilpick"` placeholder.** 실제 등록된 앱 식별자가 필요하면 나중에 교체해야 합니다.
- **지도만 실 브라우저에서 재확인 필요.** 실제 검색 결과 화면(헤더·배너·모드탭·카드·상세 추천 이유·전화걸기·내비 버튼)은 실 API 키로 브라우저에서 끝까지 확인했습니다. 카카오맵만 이 세션의 샌드박스 브라우저에서 "지도를 불러오지 못했습니다"로 떴는데, 원인을 추적한 결과 스크립트 태그로 주입한 요청만 실패하고(같은 키로 `https://dapi.kakao.com/...`에 직접 접속하면 SDK가 정상 응답함) 최상위 네비게이션은 성공해, 코드 결함이 아니라 이 브라우저 도구의 서드파티 스크립트 주입 제한으로 보입니다. 실제 브라우저에서 재확인이 필요합니다.

---

### Phase 10 — 딥링크 + 실기기

|          |                     |
| -------- | ------------------- |
| **목적** | 최종 전환 지점 확보 |
| **선행** | Phase 9             |

**완료 기준**

- URL 스냅샷 테스트 (카카오맵 · 네이버지도 · 티맵)
- **실기기 매트릭스** (⑤) — iOS Safari / Android Chrome / 카카오톡 인앱
- **인앱 브라우저에서 §6.2.1 JSON 폴백이 실제로 동작하는지 함께 확인**

---

### Phase 11 — 내 주변 + 이벤트 로깅

**완료 기준**

- 성공 지표 3종 쿼리 동작 ([`PRODUCT.md`](PRODUCT.md) §11.1)
- **PII 미저장 확인** — 좌표 격자 스냅, IP·UA 원문 없음
- 폴백 사용 여부가 이벤트에 기록됨 (§6.2.1)

> **내 주변 기능에 시간을 많이 쓰지 마십시오.** 부품 재사용이 목적입니다.

---

### Phase 12 — 예외 전수 + 배포

**완료 기준**

- 예외 A1~A15 전항목 재현·확인 ([`PRODUCT.md`](PRODUCT.md) §10.1)
- Playwright E2E 2개 통과
- 확장 시나리오 응답 12초 이내
- dev·prod 예산 분리 (`dev 100 / prod 1,300`)
- Vercel Cron 동작

---

## 11. 배포

| 항목         | 구성                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 앱           | Vercel (Next.js)                                                                                                        |
| DB           | **Neon PostgreSQL** — Vercel 마켓플레이스 경유. 런타임은 HTTP 드라이버(`@neondatabase/serverless`), 배치 스크립트는 TCP |
| 캐시         | **Upstash Redis (REST)** — 마켓플레이스 경유. 커넥션 풀 불필요                                                          |
| 배치         | GitHub Actions(CSV 스크래핑) + Vercel Cron 2개(`import-prices` 05:40, `backfill-details` 06:00 KST) — 전부 `CRON_SECRET` 인증. Hobby 크론 상한과 같음 |
| 도메인·HTTPS | Vercel 기본. **Geolocation은 HTTPS 필수**                                                                               |
| 모니터링     | Vercel Logs + 에러 트래킹(Sentry 등)                                                                                    |

마켓플레이스로 프로비저닝하면 접속 정보가 환경변수로 자동 주입됩니다. 로컬에는 `vercel env pull .env.local`로 내려받습니다.

### 11.1 서버리스 제약

| 항목                   | 주의                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **함수 실행 시간**     | **제약이 아닙니다.** Fluid compute 기준 Hobby 플랜의 기본값·최댓값이 300초라 확장 발동 시 8~12초에 여유가 충분합니다. `maxDuration`은 **폭주 방지용 상한**으로만 설정하십시오(20초 권장) |
| **인메모리 캐시 불가** | 인스턴스가 매번 새로 뜨므로 프로세스 메모리 캐시는 무의미합니다. 반드시 Redis를 쓰십시오                                                                                                 |
| **동시성 제한 구현**   | `p-limit` 등 프로세스 내 제한은 **인스턴스 단위로만** 동작합니다. 오피넷 전체 호출량 통제는 Redis 카운터로 하십시오                                                                      |
| **DB 커넥션**          | TCP 풀은 인스턴스마다 새로 뜨며 Neon 커넥션을 고갈시킵니다. **런타임에서는 HTTP 드라이버를 쓰십시오**                                                                                    |
| **스트리밍 버퍼링**    | Vercel 자체는 스트리밍을 지원하지만 **인앱 브라우저는 별개 문제**입니다. §6.2.1 JSON 폴백이 그 대응이며, Phase 10에서 실기기로 확인합니다                                                |

### 11.2 환경 분리

**카카오 앱 키는 dev·prod가 공유합니다** (§5.2). 대신 아래로 오염을 줄입니다.

- Redis 키에 `REDIS_KEY_PREFIX`(`dev`/`prod`)를 붙여 캐시를 분리
- 오피넷 일 300회 한도는 dev·prod가 계정 단위로 공유합니다. 이 예산은 이제 **시설 정보
  백필(§9.3)만** 쓰므로, 로컬에서 `pnpm data:backfill-details`를 큰 건수로 돌리면 그날
  prod 백필 몫을 잠식합니다 — 로컬 검증은 `--status`(조회 전용)나 소량(`… 20`)으로만
- 로컬 개발에서 `CACHE_BYPASS=false`를 유지해 캐시를 최대한 활용
- `verify:t3-rate`·`verify:coverage`·`verify:uturn`은 오피넷을 호출하지 않습니다(§10 Phase 5) —
  후보 조회가 `refuel_point` DB 쿼리로 끝나, 예전에 있던 오피넷 예산 확인 게이트는 제거했습니다

---

## 12. 미해결 검증 항목 — 정본 목록

**아래가 미확정 사항의 유일한 정본입니다.** 다른 문서는 이 번호를 참조합니다.

| #   | 확인                                          | 방법                                        | 실패 시 영향                                                                             | 시급도      |
| --- | --------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- |
| ⑤   | 딥링크 실기기 동작 + **SSE 폴백 동작**        | iOS Safari / Android Chrome / 카카오톡 인앱 | 최종 전환 지점 붕괴                                                                      | Phase 10    |
| ⑦   | 오피넷 상업적 이용 범위                       | 한국석유공사 문의 (052-216-2514)            | 수익화 경로 차단                                                                         | 수익화 전   |
| ⑨   | 경로 API `duration`의 실시간 교통 반영        | 러시아워/새벽 동일 경로 비교                | 시간 계산 신뢰도 저하                                                                    | 낮음        |
| ⑩   | 연료별 평균 연비 통계                         | 공식 통계 확인                              | 기본값 보정 ([`PRODUCT.md`](PRODUCT.md) §9.2)                                            | 낮음        |
| ⑭   | **실측 `ΔT` 분포 — 다노선·다연료**            | `verify:detour` (노선·연료를 바꿔가며)      | `DETOUR_TIME_CAP_RATIO`(0.5)가 정당한 후보를 자르거나 39분짜리를 통과시킴                 | Phase 10 이후 |
| ⑮   | **`SHORT_ROUTE_DETOUR_TIME_CAP_S`(20분) 적정성** | 다양한 짧은 경로 × 연료로 재측정            | 너무 짧으면 수진역 LPG류 정당한 근거리 우회를 막고, 너무 길면 사실상 별도 여정을 통과시킴 | Phase 11 이후 |

### 해결된 항목

| #   | 확인                       | 결과                                                                                                                             |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ①   | 오피넷 일일 호출 한도      | **300회/일.** 검색은 오피넷을 호출하지 않으므로(§5.3) 운영 규모를 제약하지 않음. 예산은 시설 정보 백필(§9.3)만 소비 → §5.3.1 |
| ⑥   | Vercel 함수 실행 시간 상한 | **문제 없음.** Fluid compute 기준 Hobby 300초. 8~12초 파이프라인에 여유 충분. 다만 인앱 브라우저 버퍼링은 별개이며 §6.2.1이 대응 |
| ②   | 표준데이터 컬럼 + 오피넷 UNI_ID 조인 키 | **UNI_ID·시설 컬럼 없음, 도로명주소 매칭 42%.** 표준데이터는 쓰지 않음. 마스터는 오피넷 유가 CSV(`번호` = `UNI_ID`)로 구축 (§7.1) |
| ③   | KATEC ↔ WGS84 변환 정확도 | **통과.** 왕복 오차 최대 0.01m (기준 50m). `towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43` 그대로 사용. EPSG:5179 오차 0.0000m |
| ⑪   | 오피넷 응답의 가격 기준시각 | **JSON 응답엔 없음** (`TRADE_DT`/`TRADE_TM` 미포함). 가격은 유가 CSV 스냅샷이 됐고, CSV 메타행의 기준일자를 `priced_on`(날짜)으로 표시 (§5.1). 오피넷 파라미터명은 `certkey` |
| ⑬   | Upstash 무료 티어 일일 명령 수 한도 | **10,000회/일.** 예상 사용량 665회/일 — 여유 충분. `INCRBY` 원자성 확인 |
| ⑧   | 티맵 경유지 딥링크 지원 | **미지원 — 실기기 확인 (2026-08-28).** 커뮤니티 자료에 정리된 경유지 파라미터(`rV1Name`·`rV1X`·`rV1Y`)를 붙인 `tmap://route?...`를 실기기에서 열었으나 **경유지가 경로에 반영되지 않음** — 목적지만 안내됨. 기존 가정대로 **주유소를 목적지(`rGo*`)로 전달하는 방식 유지** ([`PRODUCT.md`](PRODUCT.md) §5.5). 표본이 실기기 1대이므로 Phase 10 매트릭스에서 iOS/Android 양쪽 재확인 |
| ⑫   | 샘플링 커버리지·T2 후보 누락률 | **누락률 0%** (`verify:coverage`, 2026-08-28, 노선 3개 — 8km vs 2km 샘플 간격 T1+T2 일치). 이후 후보 수집이 회랑 bbox 쿼리로 바뀌어 T2 누락은 구조적으로 0 — 샘플링 파라미터 자체가 제거됨. **재검증(2026-09-08, `verify:coverage`, bbox vs 전수 스캔 방식으로 재작성):** 성남→춘천 노선 LPG 126곳 전수 일치, 누락 0건 — 계속 해결됨 |
| ④   | 경로 API가 유턴·중앙분리대 반영 | **반영됨 — 확인.** 실제 후보로 검증한 결과 `d_perp` 대비 실제 우회거리 비율이 노선별 중앙값 0.67~2.11(통합 약 1.4)로 현재 `DETOUR_ESTIMATE_FACTOR=2.0`과 같은 자릿수. 동시에 중앙분리대 건너편·고속도로 반대 방향 충전소에서 실제 우회가 추정의 **100~425배**에 달하는 사례를 실측으로 확인 — `PRODUCT.md` §6.5 표가 이론으로 적어둔 위험이 실측으로 재현됨. **`DETOUR_ESTIMATE_FACTOR=2.0` 유지** (표본이 노선당 6곳뿐이라 재조정 근거 부족, `verify:uturn`, 2026-08-28) |

**⑭ 현재 근거 (2026-09-08)** — 노선 **1개**(휘발유, 원익홀딩스 본사 → 수내역 40.4km)에서
추정 상위 40곳을 실측했습니다: `ΔD=0`이 60%, `ΔT` 중앙값 7.9분(p25 4.2 / p75 9.5 / 최대 39.1).
이 표본이 확정하는 것은 **"`ΔD`만으로는 우회를 판정할 수 없다"는 방향**뿐입니다
([`PRODUCT.md`](PRODUCT.md) §6.5·§11.3). `DETOUR_TIME_CAP_RATIO=0.5`는 실측값이 아니라
**거리 cap(`DETOUR_CAP_RATIO`)과의 대칭**으로 정한 값입니다 — ④의 교훈대로, 이 값을 코드에서
인용할 때는 그것이 아직 가정임을 명시하십시오.

**⑮ 현재 근거 (2026-09-08, Phase 11)** — 사용자가 실제로 검색한 짧은 경로 2건
(단대오거리역→모란역 3.4km, 남한산성입구역→을지대학교 2km — 후자는 2026-08-31에
`D_base < MIN_ROUTE_DISTANCE`면 A6 cap을 **완전히 끄는** 예외를 만들게 한 바로 그
경로다)에서, 그 예외의 근거("T3_MAX·NetSaving>0 게이트가 이미 범위를 제한한다")가
틀렸음을 확인했다 — 두 경로 모두 순절감액>0(추정 기준)이라는 이유만으로 실측 30~54분
우회가 목록에 그대로 남아 있었다(단대오거리 사례는 그마저 실측하면 음수인 것도 있었다).
`SHORT_ROUTE_DETOUR_TIME_CAP_S=20분`으로 두 경로 모두 재검증: 단대오거리는
1.4~18.1분대 8개로, 을지대학교는 10.7~13.6분대 2개로 정리됐다 — 원래 예외를 만들게 한
"정당한 근거리 우회"(수진역 LPG류, 1km 안팎)는 살아남는 값이다. **표본이 노선 2개뿐이고
"20분"이라는 값 자체는 실측 분포가 아니라 판단(사용자 확인)으로 정했다** — 여러 짧은
노선·연료로 재측정해 적정성을 교차 확인해야 한다.

**Phase 0의 넷(②③⑪⑬)이 코드 작성 전 필수였습니다.** 확장 수집이 없어지면서
`FEATURE_EXPANSION_ENABLED`·`MIN_CANDIDATES`·`OFFSET`·`SAMPLE_INTERVAL`도 함께 제거됐습니다 —
회랑 bbox 쿼리가 T3_MAX까지 한 번에 덮습니다.

**⑤ 부분 확인 (2026-08-28)** — 카카오맵·네이버지도 딥링크에 경유지를 넣어 실기기에서 열어본 결과 **양쪽 모두 경유지가 경로에 정상 반영**되었습니다. 두 앱의 경유지 파라미터는 **공식 문서에 명시된 것**입니다 — 카카오 `vp`(최대 5개, KakaoMaps SDK URL Scheme), 네이버 `v1lat`·`v1lng`·`v1name`(최대 5개, NAVER Cloud Platform Maps URL Scheme). **§5.5의 "주유소를 경유지로 포함한 경로를 열어준다"는 전제가 실기기로 확인되었습니다.** 다만 ⑤는 **미해결로 유지**합니다 — 확인한 것은 실기기 1대의 스킴 동작뿐이고, iOS/Android/카카오톡 인앱 브라우저 매트릭스와 SSE 폴백은 Phase 10 과제로 남아 있습니다.

**⑧ 검증 경위 (2026-08-28)** — 커뮤니티 자료에는 티맵 URL 스킴의 경유지 파라미터(`rV1Name`·`rV1X`·`rV1Y`, 두 번째는 `rV2*`)와 출발지 파라미터(`rSt*`)가 정리되어 있어 "지원한다"로 보였습니다. 그러나 **실기기에서 직접 열어본 결과 경유지가 반영되지 않았습니다.** 티맵이 공식 문서로 공개한 스킴이 아니므로 커뮤니티 자료를 근거로 쓰지 않습니다. **[`PRODUCT.md`](PRODUCT.md) §5.5의 "주유소를 목적지로 전달" 방식이 옳았음이 확인되었습니다.**

> **이 항목에서 얻은 교훈** — `buildTmapDeeplink`의 원래 주석은 `AGENTS.md §12`(=이 표)를 근거로 인용했지만, **이 표는 "확인해야 할 것" 목록이지 "확인된 것" 목록이 아닙니다.** 미확인 가정이 구현 근거로 승격되면서 티맵 딥링크가 기획과 반대로 동작하는 버그가 생겼고, 테스트가 그 동작을 고정시켜 오래 살아남았습니다(수정: `fix(domain)` — 티맵 딥링크). **미해결 항목을 코드에서 인용할 때는 그것이 가정임을 주석에 명시하십시오.**

**샘플링·확장 관련 미해결 항목(`SAMPLE_INTERVAL` 재조정, `MIN_CANDIDATES`·`OFFSET` 확정)은
소멸했습니다.** 후보 수집이 폴리라인 회랑 bbox 쿼리로 바뀌어 샘플 간격도, 후보 부족 시
넓혀 찾는 확장 단계도 없습니다 (MIGRATION-DB.md §7 Phase C). 해당 파라미터·함수
(`samplePolyline`·`normalOffsets`·`needsExpansion`)는 제거됐습니다.

---

## 13. 참고 링크

- [오피넷 오픈 API 이용 안내](https://www.opinet.co.kr/user/custapi/openApiIntro.do)
- [오피넷 반경 내 주유소 API 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3)
- [오피넷 주유소 상세정보(ID) API 명세](https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=1)
- [오피넷 오픈 API 목록](https://www.opinet.co.kr/user/custapi/openApiInfo.do) — 시군구별 평균가격(`avgSigunPrice.do`)·지역코드 조회(`areaCode.do`) 명세 포함 (Phase 6 §7.2)
- [오피넷 가격조사 및 공개 기준](https://www.opinet.co.kr/user/dopds/dopDs_4.do)
- [공공데이터포털 · 전국주유소표준데이터](https://www.data.go.kr/data/15129441/standard.do)
- [카카오모빌리티 길찾기 API](https://developers.kakaomobility.com/product/naviapi.html)
- [카카오모빌리티 가격 정책](https://developers.kakaomobility.com/price/)
- [카카오맵 API 무료 쿼터 정책 변경 안내](https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222)
- [카카오맵 URL Scheme](https://apis.map.kakao.com/android_v2/docs/api-guide/urlscheme/)
- [네이버 지도 앱 연동 URL Scheme](https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc)
