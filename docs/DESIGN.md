# OilPick Design System v2

> Route Atlas 방향을 기준으로 정리한 OilPick 고유 디자인시스템이다. 이 문서는 화면의 시각 언어와 컴포넌트 계약을 정의하며, 실제 CSS 토큰 구현은 다음 단계에서 `src/app/globals.css`에 연결한다.

## 1. Product identity

### Product promise

OilPick은 출발지와 목적지 사이의 도로를 기준으로 주유소의 가격, 우회 비용, 예상 절감액을 비교하게 하는 경로 의사결정 도구다.

UI의 기본 문법은 **도로의 선, 경로의 분기, 탐색 범위**다. 장식적인 금융 앱 문법이나 범용 대시보드 문법을 빌리지 않는다.

### Route Atlas

- **Mood**: 차분한 도로 지도, 이동 전의 탐색, 근거가 보이는 비교
- **Primary feeling**: “어디를 선택하면 되는지 한눈에 보인다”
- **Visual metaphor**: 기본 경로는 실선, 우회 경로는 점선, 탐색 범위는 지도 위 회랑으로 표현한다.
- **Surface**: 흰색과 아주 옅은 청색의 평평한 면을 기본으로 한다. 깊이는 색의 층과 1px 테두리로 표현한다.
- **Color behavior**: 색은 브랜드 장식보다 경로·상태·행동을 표시하는 데이터에 우선 사용한다.

### Principles

1. **Route first** — 모든 화면에서 현재 경로와 다음 행동의 관계가 먼저 읽혀야 한다.
2. **Evidence before decoration** — 가격 기준일, 추정치/실측치, 계산 전제를 숨기지 않는다.
3. **Calm density** — 정보량은 유지하되 카드, 배경, 색을 과도하게 쪼개지 않는다.
4. **Input first on mobile** — 모바일 홈에서는 출발지·목적지 입력과 검색 행동이 지도보다 먼저 온다.
5. **Product-specific grammar** — 결과 카드, 우회 고지, 경로 비교, 탐색 범위 패널은 OilPick 전용 형태로 만든다.
6. **Status is not color-only** — 경로상/우회/추정/오류는 텍스트와 선 형태를 함께 사용한다.

### Keep / change / remove from the former Toss reference

| Former Toss rule or asset | Decision in v2 | OilPick interpretation |
|---|---|---|
| Toss visual narrative and finance personas | **Remove** | 도로·경로·주유 의사결정 중심의 제품 서사로 교체 |
| `#3182F6` primary blue | **Keep** | 주요 행동과 기본 경로 강조 색으로 유지 |
| 밝은 청색 약한 CTA | **Change** | 마케팅 CTA가 아니라 탐색 범위·지도 하이라이트용으로 사용 |
| `Toss Product Sans` | **Remove** | Pretendard Variable을 기본, Space Grotesk를 숫자 보조로 사용 |
| 파란색/회색/흰색 역할 구분 | **Keep** | 경로·지도·상태·신뢰 정보 역할로 재정의 |
| 4/8 기반 간격 | **Keep** | 4px 단위 기반을 유지하되 12/20을 제품 핵심 간격으로 추가 |
| TDS 버튼·텍스트 필드·배지 상태 계약 | **Change** | OilPick의 입력, 경로 배지, 결과 카드 상태로 재작성 |
| Toss 마케팅 CTA, Agreement, 금융 전용 컴포넌트 | **Remove** | OilPick에 해당하는 컴포넌트가 아니므로 사용하지 않음 |
| 문서화되지 않은 그림자/모션을 임의 토큰화하지 않음 | **Keep** | 평평한 표면과 제한된 elevation 원칙으로 유지 |
| Toss 중심의 prompt guide | **Remove** | OilPick 토큰·제품 규칙·검증 절차로 교체 |
| evidence-backed reconstruction 정책 | **Change** | 제품 문서와 코드 계약을 우선하는 OilPick 거버넌스로 재정의 |

## 2. Foundations

### Color palette and roles

색상 이름은 용도 기준으로 부르고, 컴포넌트에서 직접 색상 값을 반복하지 않는다. 다음 단계에서 이 값을 CSS custom property와 Tailwind semantic token으로 연결한다.

#### Brand and route colors

| Role | Value | Use | Do not use |
|---|---|---|---|
| Route Blue | `#3182F6` | 기본 행동, 기본 경로, 선택 상태 | 모든 장식 요소의 기본색 |
| Route Strong | `#177DDC` | hover/pressed, 강한 경로 강조, 링크 | 본문 텍스트 전체 |
| Route Navy | `#102A43` | 제목, 핵심 수치, 지도 위 강한 라벨 | 넓은 면적의 배경 |
| Route Cyan | `#5AC8FA` | 경로 보조선, 지도 데이터, 선택된 탐색 범위 | 작은 본문 텍스트 |
| Route Sky | `#E8F4FB` | 탐색 범위 패널, 약한 선택 배경, 정보 영역 | 성공/경고 상태 대체 |
| Route Amber | `#F2B544` | 우회, 주의, 탐색 확장 | 일반적인 강조 장식 |

#### Neutral and semantic colors

| Role | Value | Use |
|---|---|---|
| Canvas | `#F8FBFD` | 앱 전체의 아주 옅은 배경 |
| Surface | `#FFFFFF` | 입력, 카드, 바텀시트, 상세 정보 면 |
| Surface Quiet | `#F2F4F6` | 비활성·보조 영역, 지도 주변부 |
| Border | `#DCE6EF` | 카드/입력/구분선의 기본 테두리 |
| Text Strong | `#102A43` | 제목, 핵심 결과, 금액 |
| Text Body | `#4E5968` | 본문과 설명 |
| Text Muted | `#829AB1` | 보조 설명, 기준일, placeholder |
| On Strong | `#FFFFFF` | Route Blue/Strong/Navy 위의 텍스트 |
| Success | `#0A8A3F` | 경로상, 절감, 완료 |
| Warning | `#B26A00` | 우회, 추정치 주의, 확인 필요 |
| Danger | `#D92D20` | 오류, 삭제, 위험 상태 |

#### Color rules

- 색상만으로 경로상/우회를 구분하지 않는다. `경로상`/`우회` 텍스트, 선 스타일, 보조 설명을 함께 보여준다.
- 밝은 청색과 cyan은 넓은 배경보다 경로와 데이터 표시를 우선한다.
- `Route Amber`는 우회 고지와 주의 상태에만 사용한다. 가격을 돋보이게 하는 장식색으로 쓰지 않는다.
- 작은 본문과 버튼 텍스트는 WCAG AA 대비를 목표로 한다. 밝은 색은 큰 텍스트나 면에만 사용한다.
- 오류/빈 상태에서도 브랜드 파랑을 성공처럼 사용하지 않는다.

### Depth and elevation

OilPick은 카드가 떠다니는 대시보드가 아니라 지도와 목록이 연결된 도구다.

- 기본 깊이: 배경색 + 1px `Border`
- 강조 깊이: `Surface` 위의 얕은 그림자 하나만 사용
- 바텀시트/다이얼로그: 배경 dim과 얕은 그림자로 현재 작업을 분리
- 금지: 유리 질감, backdrop blur, 네온 glow, 여러 겹의 강한 그림자
- 그림자는 장식이 아니라 겹침과 현재 작업의 범위를 설명할 때만 사용한다.

### Motion

- 기본 전환은 빠르고 짧게 유지하며, 입력·선택·결과 갱신의 원인을 이해하게 해야 한다.
- 검색 로딩은 `경로 확인 → 주유소 비교 → 추천 정리`의 실제 진행 상태와 연결한다.
- 우회 고지와 결과 카드가 나타날 때 과장된 spring/bounce를 사용하지 않는다.
- `prefers-reduced-motion: reduce`에서는 경로 그리기와 이동 애니메이션을 즉시 상태 전환으로 대체한다.
- 임의의 모션을 추가하기 전에 상태 변화와 사용자 이득을 먼저 기록한다.

## 3. Typography

### Font families

- **Primary**: `Pretendard Variable`, Korean body, labels, controls, long-form copy
- **Numeric/display support**: `Space Grotesk`, route distance/time, price delta, rank, short numeric emphasis
- **Fallback**: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif
- Space Grotesk는 한국어 문장이나 설명에 사용하지 않는다. 숫자와 짧은 라틴 문자에만 제한적으로 사용한다.
- 숫자 표시는 가능하면 tabular figures를 사용해 결과 카드 사이의 정렬을 유지한다.

### Type scale

| Role | Size / line height | Weight | Use |
|---|---:|---:|---|
| Display | 32 / 40px | 700 | 홈의 핵심 질문, 아주 제한된 hero copy |
| Page title | 28 / 36px | 700 | 화면 제목 |
| Section title | 22 / 30px | 700 | 결과/상세 섹션 제목 |
| Card title | 18 / 26px | 700 | 주유소명, 주요 카드 제목 |
| Body | 16 / 24px | 400–500 | 입력 설명, 결과 설명 |
| Body strong | 16 / 24px | 600–700 | 행동·핵심 결론 |
| Label | 14 / 20px | 600 | 필드 라벨, 배지, 보조 제목 |
| Caption | 12 / 18px | 400–500 | 기준일, 단위, 면책·보조 정보 |

### Typography rules

- 한 화면의 가장 큰 제목은 하나만 둔다.
- 결과 카드에서 주유소명보다 순위·절감액·경로 상태를 과도하게 키워 경쟁시키지 않는다. 핵심 결론 → 가격 → 경로 근거 순으로 읽힌다.
- `12px`는 보조 정보에만 사용하고, 주요 행동이나 필드 라벨에는 사용하지 않는다.
- 긴 한국어 문장은 짧게 나누고, 금액·거리·시간의 단위를 숫자에 붙여 의미를 분명하게 한다.
- 추정치는 `약 N km`처럼 표시하고, 실측치와 동일한 시각 강조를 주지 않는다.

## 4. Components

### Route spine

OilPick 전용 기본 컴포넌트다.

- 출발지와 목적지를 연결하는 세로 선과 노드를 사용한다.
- 기본 경로는 실선, 우회 경로는 점선으로 표현한다.
- 선의 색은 경로 상태를 보조하고, 상태명은 텍스트로 함께 제공한다.
- 지도 장식처럼 반복 사용하지 않고, 입력 폼·결과 카드·상세 추천 이유를 연결할 때만 사용한다.

### Search form

- 모바일에서 출발지 → 목적지 → 연료/차량 설정 → 검색 CTA 순서를 유지한다.
- 출발지와 목적지 필드는 52px 높이를 기본으로 하고, 실제 터치 영역은 최소 44px 이상으로 보장한다.
- swap/reset은 텍스트 또는 명확한 접근성 이름을 가진 작은 컨트롤로 제공한다. 아이콘만으로 의미를 맡기지 않는다.
- 지도는 모바일 폼을 가리지 않는 보조 미리보기로 배치하고, 데스크톱에서는 입력 영역과 나란히 둔다.

### Primary and secondary actions

| Type | Height | Radius | Visual treatment |
|---|---:|---:|---|
| Primary CTA | 56px mobile / 52px desktop | 14px | Route Blue fill, white label |
| Secondary action | 44px | 12px | white or Route Sky fill, Border |
| Tertiary action | 44px minimum touch area | 10px | text/link treatment, no decorative pill |

- Primary CTA는 한 화면에서 현재 다음 단계 하나만 대표한다.
- loading은 버튼 너비와 라벨 영역을 유지한다.
- disabled는 비활성 이유를 숨기지 않고, 가능하면 도움말이나 입력 오류와 연결한다.
- focus-visible은 색상과 2px 이상의 명확한 외곽선으로 표시한다.

### Route status badge

- `경로상`은 Success 계열과 실선 보조 표현을 사용한다.
- `우회`는 Warning 계열과 점선 보조 표현을 사용한다.
- 배지는 판단 결과를 짧게 보여주는 메타데이터이며 버튼처럼 보이지 않는다.
- `d_perp`는 배지 판정값으로 노출하지 않는다. 배지의 근거는 실측 `ΔT`·`ΔD`이고, 회랑 범위 설명의 `N km`는 기하 도달 거리다.

### Result card

결과 카드는 범용 카드 템플릿이 아니라 OilPick의 핵심 의사결정 단위다.

- 읽기 순서: 순위/상태 → 주유소명 → 가격·기준일 → 예상 절감액 → 경로 근거 → 시설/상세 이동
- 흰색 표면, 1px Border, 16px radius를 기본으로 한다.
- 카드 전체가 링크일 때도 내부의 버튼·링크와 충돌하지 않게 한다.
- `NetSaving`, 가격 차이, 경로상/우회 상태를 같은 시각 계층 안에서 비교 가능하게 한다.
- 추정치는 카드에서 `약`과 `▸`로 구분하고, 정밀 `ΔT`·`ΔD`는 상세에서 보여준다.
- 가격 기준일을 가격 옆에 둔다. 기준일을 카드 하단에 숨기지 않는다.

### Route comparison

- 기본 경로와 후보 경유 경로의 차이를 같은 단위로 비교한다.
- 실선/점선, 소요 시간, 거리, 절감액을 함께 사용한다.
- 경로상 후보가 있으면 우회 후보와 우회 허용 시간을 목록에 섞지 않는다.

### Expansion range panel

- 최종 후보에 T3 우회가 포함될 때 결과 목록 상단에 둔다.
- `Route Amber`와 `Route Sky`를 사용하되, 경고처럼 불안감을 만들지 않는 설명형 패널로 만든다.
- “얼마나 멀리까지 살폈는가”를 설명하는 패널이며, 개별 후보의 확정 우회비용을 대신하지 않는다.
- 우회 허용 시간은 결과를 클라이언트에서 잘라내는 필터가 아니라 재검색 입력임을 UI에서도 분명히 한다.

### Map

- 지도는 제품의 배경 장식이 아니라 경로와 후보를 설명하는 근거 영역이다.
- 기본 경로, 우회 경로, 주유소 후보, 현재 탐색 범위를 시각적으로 분리한다.
- 지도 위 텍스트는 최소화하고, 목록/상세의 수치와 중복되는 설명을 남발하지 않는다.
- 모바일에서는 목록과 입력을 우선하고 지도는 보조 영역으로 둔다. 지도 조작은 충분한 터치 여유를 가진다.

### Filter, tabs, and sheets

- 필터는 결과를 다시 검색하는 조건과 이미 받은 목록을 정렬/표시하는 상태를 혼동하지 않게 설명한다.
- 모바일 필터는 Drawer/Sheet 안에 넣되, 적용 전 현재 선택값과 결과에 미치는 영향을 읽을 수 있어야 한다.
- 탭은 활성 상태뿐 아니라 키보드 focus, 방향키 이동, `aria-selected`를 지원한다.
- 필터·탭·배지는 작은 알약을 반복해 화면을 템플릿처럼 만들지 않는다.

## 5. Trust and state contracts

이 절의 요소는 시각적 간결함을 위해 삭제하거나 숨기지 않는다.

| Required element | Placement |
|---|---|
| 가격 기준일자 | 모든 가격 옆 |
| 계산 전제 | 모바일 결과 목록 하단, 데스크톱 결과 사이드바 |
| 우회 고지 배너 | 최종 후보에 T3 우회가 남을 때 결과 목록 상단 |
| 면책 문구 | 주유소 상세 |
| 전화번호 | 상세에 값이 있을 때 |
| 티맵 경유지 제한 안내 | 딥링크 영역 |
| 후보 0건 대안 | 실패/빈 결과 화면 |

### State language

- **Loading**: 실제 검색 단계를 표시하되, 완료되지 않은 가격이나 절감액을 확정값처럼 보여주지 않는다.
- **Partial**: 일부 결과가 먼저 도착하면 부분 결과임을 명시하고 최종 상태와 구분한다.
- **Empty**: 0건의 이유와 조정 가능한 조건, 다음 행동을 함께 제공한다.
- **Error**: 문제가 발생한 영역을 설명하고 재시도/조건 수정 경로를 제공한다.
- **Estimate**: `약 N km`, `예상 절감액`처럼 추정 상태를 보존한다.
- **Measured**: 실측 `ΔT`, `ΔD`는 상세에서 단위와 함께 표시한다.

## 6. Layout and responsive behavior

### Spacing scale

4px 기반을 유지하되 OilPick의 반복 간격은 다음 값을 우선한다.

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48`

- 화면 좌우 여백: 모바일 16–20px
- 입력 필드 사이: 12px
- 섹션 사이: 24–32px
- 카드 내부: 16px
- 카드 사이: 12px
- 데스크톱 페이지의 주요 컬럼 간격: 24–32px

### Radius scale

`8px`은 작은 control, `12px`은 secondary control, `14px`은 primary CTA, `16px`은 카드/입력, `20px`은 큰 패널에 사용한다.

- 모든 요소를 pill 형태로 만들지 않는다.
- 원형은 아바타가 아니라 지도 노드, 진행 표시 등 실제 의미가 있을 때만 사용한다.

### Responsive rules

- **Mobile**: 입력과 검색 행동 → 최근/주변 정보 → 지도 보조 영역 순서. 결과는 목록 중심, 지도는 필요할 때 확인한다.
- **Desktop**: 입력/결과 목록과 지도 영역을 나란히 배치하되, 계산 전제와 경로 근거가 시야에서 밀리지 않게 한다.
- 모바일 상세에서는 가격·핵심 추천 이유·길찾기 행동이 긴 시설 정보보다 먼저 온다.
- safe-area와 sticky CTA를 사용할 때 콘텐츠가 가려지지 않도록 하단 여백을 함께 확보한다.
- 모든 주요 조작의 터치 영역은 최소 44×44px이다.

### Accessibility

- 본문·버튼 텍스트는 WCAG AA 대비를 목표로 한다.
- 포커스 순서는 화면의 읽기 순서와 일치해야 한다.
- 입력은 visible label을 가지며 placeholder를 label 대용으로 사용하지 않는다.
- 자동완성은 combobox/listbox semantics와 키보드 이동을 제공한다.
- 지도에 표시된 정보는 목록 또는 텍스트 요약으로도 접근할 수 있어야 한다.
- 상태를 색상만으로 전달하지 않는다.
- `prefers-reduced-motion`을 존중한다.

## 7. Content and voice

### Voice

OilPick은 운전자에게 결정을 대신 강요하지 않고, 선택에 필요한 근거를 짧고 정확하게 보여준다.

- 결과를 먼저 말한다: “경로상에서 가장 아끼는 주유소”처럼 결론을 앞에 둔다.
- 숫자의 상태를 말한다: “예상”, “약”, “기준일”, “실측”을 구분한다.
- 도메인 용어는 화면 안에서 바로 풀어쓴다.
- “최저가”처럼 전체 시장을 보장하는 표현은 실제 계약이 없으면 쓰지 않는다.
- 장난스러운 카피, 과장된 절감 약속, 불안을 자극하는 경고를 쓰지 않는다.

### Content ownership

- 문구 원문·도메인 규칙: `docs/PRODUCT.md`
- API·레이어·데이터 계약: `docs/ARCHITECTURE.md`
- 색·타이포·컴포넌트·레이아웃 계약: 이 문서
- 구현 토큰: 다음 단계의 `src/app/globals.css` 및 관련 UI 토큰

## 8. Governance

### Application priority

1. 사용자 지시
2. `AGENTS.md`의 변경 금지 규칙
3. `docs/PRODUCT.md`의 제품·문구·계산 계약
4. `docs/ARCHITECTURE.md`의 구조·API 계약
5. 이 문서의 시각·컴포넌트 계약
6. 코드의 현재 구현

문서와 코드가 다르면 변경 범위를 확인하고, UI 작업은 이 문서를 기준으로 정리한다. 기능·라우팅·데이터 계약을 시각 개선의 이유로 바꾸지 않는다.

### New token or component

- 색·폰트·간격·radius·shadow 값을 새로 만들기 전에 이 문서의 역할로 설명한다.
- 구현 시 raw hex, 임의의 pixel, 컴포넌트별 중복 값을 만들지 않고 semantic token을 사용한다.
- 새 shadcn/ui 컴포넌트는 기존 승인 목록 밖이면 먼저 사용자 승인을 받는다.
- OilPick 전용 결과 카드, 경로 spine, 우회 고지, 로딩 단계는 기성 카드/배지 조합으로 대체하지 않는다.

### Validation checklist

- 모바일 390px 전후에서 입력 → 검색 CTA가 첫 화면에서 자연스럽게 이어지는가?
- 결과 카드에서 순위, 상태, 가격, 기준일, 절감액, 경로 근거가 한 번에 비교되는가?
- 추정치와 실측치가 시각·문구로 구분되는가?
- 우회 후보가 있을 때 고지와 탐색 범위가 보이는가?
- 후보 0건에서 조정 가능한 조건과 다음 행동이 보이는가?
- 키보드 focus, 자동완성, 탭 이동, 44px 터치 영역이 보장되는가?
- 대비와 reduced motion을 확인했는가?

### Change record

- **v2**: Toss 기반 레퍼런스를 제거하고 Route Atlas를 OilPick의 고유 방향으로 채택했다.
- **v2**: 기존 primary blue, 간격의 4px 기반, 상태 계약의 명시성은 유지했다.
- **v2**: 금융/마케팅 전용 컴포넌트, Toss 전용 폰트·서사·CTA는 삭제했다.
- **v2**: 경로 spine, 실선/점선 의미, 탐색 범위 패널, 결과 카드, 신뢰 정보 배치를 OilPick 전용 규칙으로 정의했다.
