# Phase 0 — 사전 검증 스크립트

> **상태: 초기 검증 완료 · 현재는 재검증용**
>
> 이 문서는 저장소를 처음 구축할 때 수행한 Phase 0의 실행 기록입니다. 관련 외부 API,
> 좌표 변환, 데이터 형식 또는 튜닝 파라미터를 바꿀 때만 필요한 스크립트를 다시 실행합니다.
> 현재 개발을 Phase 1부터 다시 시작하라는 뜻이 아닙니다.

초기 구축 당시 이 스크립트들의 결과가 `domain/types.ts`, DB 스키마, UI 불변식 구현 방식을
결정했습니다.

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

**재검증할 때는 아래 순서로 실행하십시오.**

```bash
# ① 좌표 변환 정확도 (가장 먼저 — 오피넷 호출 없음)
pnpm verify:coord

# ② 표준데이터 구조 확인 (파일 경로 지정)
#    행안부 공공데이터포털에서 CSV를 먼저 내려받으십시오
pnpm verify:standard-data ./data/full_oil_standard.csv

# ③ 오피넷 가격 기준시각 (오피넷 2~3회 호출)
pnpm verify:price-time

# ④ Upstash Redis 연결·원자성·월간 한도 (Upstash 여러 회 호출)
pnpm verify:upstash
```

**Phase 5 — 파라미터 확정용 (오피넷·카카오 다회 호출, `--yes` 없이는 계획만 출력).**

```bash
pnpm verify:coverage   -- --route=all --yes
pnpm verify:t3-rate    -- --fuel=LPG
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
| `verify:coverage` (Phase 5) | 카카오 1회 + DB 조회 | 회랑 bbox가 전국 전수 스캔의 후보를 빠뜨리지 않는지 |
| `verify:t3-rate` (Phase 5) | 카카오 1회 + DB 조회·평균가 집계 | 현재 회랑 후보 수와 `P_ref` 기준가 폴백 상태 |
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

`ARCHITECTURE.md §5.1`의 CSV 경로를 확인합니다. 현재 가격은 오피넷의
전국 CSV 스냅샷 기준일자(`priced_on`)를 사용하며, 별도의 갱신 시각을 추정하지
않습니다. CSV 임포트가 실패하면 마지막으로 성공한 DB 스냅샷이 유지됩니다.

---

## 재검증 후 해야 하는 것

관련 스크립트를 다시 실행했다면:

1. **기존 검증 결과와 비교합니다**
   - `ARCHITECTURE.md §12`의 해결된 항목이 다시 깨지지 않았는지 확인
   - 결과가 달라졌다면 `PRODUCT.md`·`ARCHITECTURE.md`·`AGENTS.md`의 소유 범위에 맞춰 갱신

2. **외부 응답 형식이 바뀌었을 때만 픽스처를 갱신합니다**
   - `tests/fixtures/opinet-*.json` 등 해당 실 응답 픽스처

3. **관련 단위·통합 테스트를 실행합니다**
   - 변경한 외부 경계·도메인 계산·서비스 흐름에 해당하는 현재 테스트

