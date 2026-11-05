# Phase 0 — 사전 검증 스크립트

**코드를 쓰기 전에 반드시 실행하십시오.** 이 스크립트들의 결과가
`domain/types.ts`, DB 스키마, UI 불변식 구현 방식을 결정합니다.

---

## 빠른 시작

> **Phase 1 이후 갱신:** 이 스크립트들은 원래 Next.js와 별개인 `scripts/package.json` 독립 프로젝트였습니다. Phase 5부터 `@/domain`·`@/infra`를 그대로 재사용해야 해서 **루트 프로젝트로 흡수**했습니다 — `scripts/package.json`·`tsconfig.json`은 삭제되었고, 지금은 루트의 `tsx`로 실행합니다. 진입 스크립트가 `.mts`인 이유는 ARCHITECTURE.md §2 참고.

### 1. 스크립트 폴더 구조

```
oilpick/              ← 프로젝트 루트
  scripts/
    _shared.ts
    verify/
      _routes.ts           # Phase 5 측정용 노선 4개
      _measure-shared.ts   # Phase 5 공용 — 예산 확인 등
      coord.mts
      standard-data.mts
      price-time.mts
      upstash.mts
      coverage.mts
      t3-rate.mts
      uturn.mts
    README-phase0.md
  .env.local           ← 환경변수 (루트)
```

### 2. 환경변수 설정

`.env.local` (프로젝트 루트):

```bash
OPINET_CERT_KEY=여기에_오피넷_인증키
KAKAO_REST_API_KEY=여기에_카카오_REST_키
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...
REDIS_KEY_PREFIX=dev
```

### 3. 실행 (루트에서)

**Phase 0 — 반드시 이 순서로 실행하십시오.**

```bash
# ① 좌표 변환 정확도 (가장 먼저 — 오피넷 호출 없음)
pnpm verify:coord

# ② 표준데이터 구조 확인 (파일 경로 지정)
#    행안부 공공데이터포털에서 CSV를 먼저 내려받으십시오
pnpm verify:standard-data ./data/full_oil_standard.csv

# ③ 오피넷 가격 기준시각 (오피넷 2~3회 호출)
pnpm verify:price-time

# ④ Upstash Redis 연결·한도 (Upstash 여러 회 호출)
pnpm verify:upstash
```

**Phase 5 — 파라미터 확정용 (오피넷·카카오 다회 호출, `--yes` 없이는 계획만 출력).**

```bash
pnpm verify:coverage   -- --route=all --yes
pnpm verify:t3-rate    -- --fuel=LPG --yes
pnpm verify:uturn      -- --route=0 --yes
```

---

## 스크립트별 요약

| 스크립트 | 오피넷 호출 | 무엇을 결정하는가 |
|---|---|---|
| `verify:coord` | **0회** | `towgs84` 파라미터 / `domain/geo.ts` 투영 정의 |
| `verify:standard-data` | **0회** | DB 마스터 전략 / 시설 필터 구현 방식 |
| `verify:price-time` | **2~3회** | UI 불변식 "가격 기준시각" 구현 방식 |
| `verify:upstash` | **~20회** (Redis) | 캐시 전략 유지 여부 |
| `verify:coverage` (Phase 5) | 노선당 수십 회 — 실행 전 출력됨 | `SAMPLE_INTERVAL`·`OFFSET`·`T2_MAX`·`T3_MAX` |
| `verify:t3-rate` (Phase 5) | 조합당 최대 수십 회 — 실행 전 출력됨 | `MIN_CANDIDATES`, T3 발동률·게이트 통과율 |
| `verify:uturn` (Phase 5) | 1회 (카카오는 여러 회, 쿼터 넉넉함) | 직선거리와 실제 우회거리 편차 확인 |

---

## 통과 기준

| 항목 | 기준 | 실패 시 |
|---|---|---|
| KATEC 왕복 오차 | **50m 이내** | `towgs84` 파라미터 재조정 후 재실행 |
| EPSG:5179 왕복 오차 | **1m 이내** | 투영 정의 재확인 |
| UNI_ID 조인 키 | 발견 | §7.1 폴백 경로 결정 필요 |
| 좌표 컬럼 | 발견 | 마스터 구축 방식 재설계 |
| Redis PING | PONG | URL·TOKEN 재확인 |
| INCRBY 원자성 | 3×13 = 39 | Upstash 플랜·설정 확인 |

---

## 픽스처 저장 위치

`verify:price-time` 실행 후 자동으로 생성됩니다:

```
oilpick/
  tests/
    fixtures/
      opinet-radius.json   ← 반경검색 실제 응답
      opinet-detail.json   ← 상세정보 실제 응답
```

카카오 응답 픽스처는 Phase 4 착수 전에 별도로 저장하십시오:

```bash
# 카카오모빌리티 길찾기 응답 예시 저장
curl "https://apis-navi.kakaomobility.com/v1/directions?..." \
  -H "Authorization: KakaoAK $KAKAO_REST_API_KEY" \
  | jq . > tests/fixtures/kakao-directions.json
```

---

## 실패 사례와 대응

### KATEC 왕복 오차 > 50m

`towgs84` 파라미터가 환경에 따라 달라집니다. 국토지리정보원의
공식 파라미터를 확인하거나, `proj4` 저장소의 한국 정의를 교차 검증하십시오.

```ts
// 시도해볼 대안 파라미터
'+towgs84=-146.43,507.89,685.07,1.09,-2.89,-2.71,-0.085'
```

### UNI_ID 조인 키 없음

폴백 B(좌표+상호명 매칭)를 시도합니다. `import-standard-data.ts` 작성 전에
샘플 100건으로 매칭률을 먼저 측정하십시오. 매칭률이 80% 미만이면
폴백 C(표준데이터 포기, 오피넷 상세 API + Redis 캐시)를 채택합니다.

### 가격 기준시각 없음

`ARCHITECTURE.md §5.1`의 두 번째 경로를 채택합니다:
오피넷 갱신 스케줄(1·2·9·12·16·19시)로 "최근 갱신 시각"을 역산합니다.
`domain/cache-ttl.ts`의 `priceTtlSeconds` 함수가 이 로직을 담당합니다.

---

## Phase 0 완료 후 해야 하는 것

모든 스크립트가 통과하면:

1. **결과를 문서에 반영합니다**
   - `ARCHITECTURE.md §12`의 ②③⑪⑬을 "해결됨"으로 표시
   - 가격 기준시각 결과에 따라 `§5.1`과 `AGENTS.md §6` 갱신

2. **픽스처를 커밋합니다**
   - `tests/fixtures/opinet-*.json`

3. **Phase 1로 진행합니다**
   - Next.js 초기화 + ESLint 경계 규칙 + CI

