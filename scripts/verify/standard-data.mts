/**
 * verify:standard-data — 전국주유소표준데이터 구조 검증 [§12 ②]
 *
 * 검증 항목
 *   1. 오피넷 UNI_ID (또는 대체 조인 키) 존재 여부
 *   2. 좌표 컬럼 (경위도 또는 KATEC) 존재 여부
 *   3. 시설 컬럼 (세차·경정비·편의점) 존재 여부
 *   4. 지역 코드 컬럼 (SIGUNCD 계열) 존재 여부
 *   5. 전체 레코드 수 (약 11,000건인지)
 *   6. 결측률 (핵심 컬럼)
 *
 * 결론이 영향을 주는 것
 *   - DB 마스터 구축 전략 (ARCHITECTURE.md §7.1)
 *   - 시설 필터 구현 방식
 *   - 조인 실패 시 폴백 경로 결정
 *
 * 실행 전 준비
 *   행안부 공공데이터포털(data.go.kr) 또는 오피넷 사이트에서
 *   "전국주유소정보표준데이터" CSV/XLS를 내려받아 경로를 지정하십시오.
 *
 *   pnpm exec tsx scripts/verify/standard-data.mts [파일경로]
 *
 *   파일경로 생략 시 기본값: ./data/full_oil_standard.csv
 *
 * 의존: 루트 프로젝트에 설치된 csv-parse
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { ok, fail, warn, info, header, summary } from '../_shared';

// ─── 설정 ────────────────────────────────────────────────────────────────

const DATA_FILE = process.argv[2] ?? './data/full_oil_standard.csv';

// 오피넷 UNI_ID 후보 컬럼명 (실제 파일에 따라 다를 수 있음)
const UNI_ID_CANDIDATES = [
  'UNI_ID', 'uni_id', '유니아이디', '주유소ID', 'STATION_ID',
  'GS_ID', '고유번호', '유일ID',
];

// 좌표 컬럼 후보
const LAT_CANDIDATES  = ['WGS84LAT', 'LAT', 'Y', 'LATITUDE', '위도', 'GIS_Y_COOR'];
const LNG_CANDIDATES  = ['WGS84LON', 'LNG', 'LON', 'X', 'LONGITUDE', '경도', 'GIS_X_COOR'];
const KATEC_X_CANDIDATES = ['X', 'GIS_X_COOR', 'KATEC_X', 'TM_X'];
const KATEC_Y_CANDIDATES = ['Y', 'GIS_Y_COOR', 'KATEC_Y', 'TM_Y'];

// 시설 컬럼 후보
const FACILITY_CANDIDATES: Record<string, string[]> = {
  carWash:     ['CARWASH_YN', 'CAR_WASH', '세차기', '세차여부', 'CARWASH'],
  maintenance: ['KPETRO_YN', 'MAINT_YN', '경정비', '정비여부', 'OIL_CHANGE', 'MAINTENANCE'],
  cvs:         ['CVS_YN', '편의점', 'CONVENIENCE', 'CVS'],
};

// 지역코드 컬럼 후보
const SIGUNCD_CANDIDATES = ['SIGUNCD', 'SIGUN_CD', '시군구코드', 'CITY_CD', 'SIGOON_CD'];

// ─── 파일 읽기 ────────────────────────────────────────────────────────────

header('전국주유소표준데이터 구조 검증');
info(`파일: ${path.resolve(DATA_FILE)}`);

if (!fs.existsSync(DATA_FILE)) {
  fail(`파일을 찾을 수 없습니다: ${DATA_FILE}`);
  console.log('\n  행안부 공공데이터포털(https://www.data.go.kr)에서');
  console.log('  "전국주유소정보표준데이터"를 검색해 CSV를 내려받으십시오.');
  console.log(`  내려받은 파일을 ${DATA_FILE} 경로에 놓거나 경로 인자로 지정하십시오.`);
  process.exit(1);
}

const fileContent = fs.readFileSync(DATA_FILE);
let records: Record<string, string>[];

try {
  // BOM 처리 + EUC-KR 인코딩 가능성 → 일단 utf-8 시도
  records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];
} catch (e) {
  fail(`CSV 파싱 실패: ${String(e)}`);
  warn('EUC-KR로 인코딩된 파일이라면 먼저 UTF-8로 변환하십시오:');
  warn('  iconv -f euc-kr -t utf-8 파일명.csv > 파일명_utf8.csv');
  process.exit(1);
}

if (records.length === 0) {
  fail('레코드가 0건입니다. 파일 내용을 확인하십시오.');
  process.exit(1);
}

const TOTAL = records.length;
const COLUMNS = Object.keys(records[0]);

info(`레코드 수: ${TOTAL.toLocaleString()}건`);
info(`컬럼 수: ${COLUMNS.length}개`);
info(`컬럼 목록: ${COLUMNS.slice(0, 20).join(', ')}${COLUMNS.length > 20 ? ' ...' : ''}`);

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

function findColumn(candidates: string[]): string | null {
  return candidates.find(c => COLUMNS.includes(c)) ?? null;
}

function missingRate(col: string): number {
  const missing = records.filter(r => !r[col] || r[col].trim() === '').length;
  return missing / TOTAL;
}

// ─── 검증 ────────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];
const findings: Record<string, string> = {};

function record(label: string, isOk: boolean) {
  if (isOk) passed.push(label);
  else failed.push(label);
}

// 1. 레코드 수
header('① 레코드 수 (기대값 약 10,000~13,000건)');
{
  const label = '레코드 수';
  if (TOTAL >= 9_000 && TOTAL <= 15_000) {
    ok(`${TOTAL.toLocaleString()}건 — 정상 범위`);
    record(label, true);
  } else if (TOTAL < 100) {
    fail(`${TOTAL}건 — 너무 적음. 헤더 행 파싱 오류 또는 인코딩 문제일 수 있음`);
    record(label, false);
  } else {
    warn(`${TOTAL.toLocaleString()}건 — 예상 범위(9,000~15,000) 밖. 데이터 버전 확인 필요`);
    record(label, true); // 경고이지만 통과로 처리
  }
}

// 2. 조인 키 (UNI_ID)
header('② 오피넷 UNI_ID 조인 키');
{
  const col = findColumn(UNI_ID_CANDIDATES);
  const label = 'UNI_ID 조인 키';

  if (col) {
    const rate = missingRate(col);
    const sample = [...new Set(records.slice(0, 3).map(r => r[col]))];
    findings.uniIdCol = col;

    if (rate < 0.01) {
      ok(`컬럼 "${col}" 발견. 결측률 ${(rate * 100).toFixed(1)}%. 예시: ${sample.join(', ')}`);
      record(label, true);
    } else {
      warn(`컬럼 "${col}" 발견했으나 결측률이 ${(rate * 100).toFixed(1)}%로 높습니다.`);
      warn('  결측 레코드에는 좌표+상호명 유사도 매칭(폴백 2)이 필요합니다.');
      findings.uniIdCol = col;
      record(label, true); // 발견했으므로 일단 통과
    }
  } else {
    fail(`UNI_ID 조인 키를 찾지 못했습니다.`);
    fail(`  탐색한 컬럼명: ${UNI_ID_CANDIDATES.join(', ')}`);
    warn('  폴백 경로: 좌표 근접(50m) + 상호명 유사도 매칭 (ARCHITECTURE.md §7.1)');
    warn('  또는 상호명+주소 조합으로 전처리 조인 키 생성 시도');
    findings.uniIdCol = '없음';
    record(label, false);
  }
}

// 3. 좌표 컬럼
header('③ 좌표 컬럼');
{
  const latCol = findColumn(LAT_CANDIDATES);
  const lngCol = findColumn(LNG_CANDIDATES);
  const label = '좌표 컬럼';

  if (latCol && lngCol) {
    const rate = Math.max(missingRate(latCol), missingRate(lngCol));
    const sample = records[0];
    const sampleLat = parseFloat(sample[latCol]);
    const sampleLng = parseFloat(sample[lngCol]);

    findings.latCol = latCol;
    findings.lngCol = lngCol;

    // 한반도 범위 체크: 위도 33~38, 경도 124~130
    const inKorea = sampleLat >= 33 && sampleLat <= 39 && sampleLng >= 124 && sampleLng <= 132;

    if (inKorea && rate < 0.01) {
      ok(`위도: "${latCol}", 경도: "${lngCol}". 결측률 ${(rate * 100).toFixed(1)}%`);
      ok(`좌표 범위 확인 — 첫 레코드: lat=${sampleLat}, lng=${sampleLng} (한반도 내)`);
      record(label, true);
    } else if (!inKorea) {
      warn(`첫 레코드 좌표(${sampleLat}, ${sampleLng})가 한반도 범위 밖입니다.`);
      warn('  KATEC 좌표일 가능성: 변환 필요. 또는 X·Y가 뒤바뀐 것인지 확인하십시오.');
      findings.coordIsKatec = 'maybe';
      record(label, true); // 존재하므로 통과, 경고로 처리
    } else {
      fail(`결측률 ${(rate * 100).toFixed(1)}% — 좌표 없는 레코드가 많습니다.`);
      record(label, false);
    }
  } else {
    // WGS84가 없으면 KATEC 확인
    const katecX = findColumn(KATEC_X_CANDIDATES);
    const katecY = findColumn(KATEC_Y_CANDIDATES);

    if (katecX && katecY) {
      warn(`WGS84 좌표 컬럼이 없습니다. KATEC 좌표만 있습니다: X="${katecX}", Y="${katecY}"`);
      warn('  임포트 시 KATEC → WGS84 변환이 필요합니다.');
      warn('  verify:coord 결과를 먼저 확인한 뒤 변환 로직을 작성하십시오.');
      findings.latCol = `KATEC:${katecY}`;
      findings.lngCol = `KATEC:${katecX}`;
      record(label, true);
    } else {
      fail('좌표 컬럼(위도/경도 또는 KATEC X/Y)을 찾지 못했습니다.');
      fail(`  탐색: ${[...LAT_CANDIDATES, ...KATEC_Y_CANDIDATES].join(', ')}`);
      record(label, false);
    }
  }
}

// 4. 시설 컬럼
header('④ 시설 컬럼 (세차·경정비·편의점)');
{
  for (const [facility, candidates] of Object.entries(FACILITY_CANDIDATES)) {
    const col = findColumn(candidates);
    const label = `시설 컬럼 — ${facility}`;

    if (col) {
      const rate = missingRate(col);
      const values = [...new Set(records.slice(0, 20).map(r => r[col]).filter(Boolean))];
      findings[`facility_${facility}`] = col;
      ok(`"${col}" 발견. 결측률 ${(rate * 100).toFixed(1)}%. 값 예시: ${values.slice(0, 4).join(', ')}`);
      record(label, true);
    } else {
      fail(`${facility} 컬럼 없음. 탐색: ${candidates.join(', ')}`);
      warn('  → 시설 필터가 오피넷 상세 API N+1로 회귀합니다.');
      warn('    ARCHITECTURE.md §7.1 폴백 3번(캐시 방식)을 검토하십시오.');
      findings[`facility_${facility}`] = '없음';
      record(label, false);
    }
  }
}

// 5. 지역코드 컬럼
header('⑤ 지역코드 컬럼 (P_ref 시군구 폴백용)');
{
  const col = findColumn(SIGUNCD_CANDIDATES);
  const label = '시군구코드';

  if (col) {
    const rate = missingRate(col);
    const sample = [...new Set(records.slice(0, 3).map(r => r[col]))];
    ok(`"${col}" 발견. 결측률 ${(rate * 100).toFixed(1)}%. 예시: ${sample.join(', ')}`);
    findings.sigunCdCol = col;
    record(label, true);
  } else {
    warn(`지역코드 컬럼을 찾지 못했습니다. 탐색: ${SIGUNCD_CANDIDATES.join(', ')}`);
    warn('  → P_ref 폴백 시 좌표 기반으로 시군구 코드를 역산해야 합니다.');
    findings.sigunCdCol = '없음';
    record(label, false);
  }
}

// ─── 종합 결과 ────────────────────────────────────────────────────────────
const allPassed = summary(passed, failed);

console.log('\n── 발견된 컬럼 매핑 요약 ────────────────────────────────');
for (const [k, v] of Object.entries(findings)) {
  console.log(`  ${k.padEnd(24)} → ${v}`);
}

console.log('\n── 다음 단계 ──────────────────────────────────────────');
if (findings.uniIdCol && findings.uniIdCol !== '없음') {
  info('UNI_ID 조인 키 확인됨 → ARCHITECTURE.md §7.1의 A안(표준데이터 직접 조인)으로 진행.');
  info('scripts/import-standard-data.ts 작성 시 발견된 컬럼명을 사용하십시오.');
} else {
  warn('UNI_ID 없음 → 폴백 경로 결정 후 ARCHITECTURE.md §7.1 갱신 필요.');
  warn('  폴백 B (좌표+상호명 매칭) 구현 전 매칭률을 먼저 실측하십시오.');
}

if (!allPassed) {
  warn('\n시설 컬럼이 없으면 ARCHITECTURE.md §8.2의 7일 캐시 폴백이 발동합니다.');
  warn('Phase 6 착수 전 이 결과를 ARCHITECTURE.md에 반영하십시오.');
}

process.exit(allPassed ? 0 : 1);
