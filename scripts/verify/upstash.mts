/**
 * verify:upstash — Upstash Redis 한도·연결 검증 [§12 ⑬]
 *
 * 검증 항목
 *   1. REST API 연결 (PING)
 *   2. SET / GET / DEL 기본 동작
 *   3. INCRBY + EXPIRE — 오피넷 예산 카운터 패턴
 *   4. 응답 지연 (서버리스 환경에서 허용 가능한지)
 *   5. 무료 티어 월간 명령 수 한도 확인 방법 안내
 *      (API로 직접 조회는 불가. 콘솔 + 수동 계산으로 안내)
 *
 * 결론이 영향을 주는 것
 *   - 캐시 전략 유지 여부 (ARCHITECTURE.md §8)
 *   - 무료 티어 초과 위험 시 캐시 TTL 재설계
 *
 * 실행: pnpm verify:upstash
 * 필요: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 환경변수
 */

import { ok, fail, warn, info, header, summary, requireEnv } from '../_shared';

// ─── 설정 ────────────────────────────────────────────────────────────────

const env = requireEnv(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
const BASE_URL = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
const TOKEN    = env.UPSTASH_REDIS_REST_TOKEN;

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dev';
const TEST_KEY   = `${KEY_PREFIX}:verify:test`;
const BUDGET_KEY = `${KEY_PREFIX}:opinet:budget:verify`;

// ─── REST 래퍼 ────────────────────────────────────────────────────────────

async function redisCmd<T = unknown>(...args: (string | number)[]): Promise<T> {
  const res = await fetch(`${BASE_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  const json = await res.json() as { result: T; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result;
}

async function redisPipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${BASE_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`pipeline HTTP ${res.status}`);
  const json = await res.json() as Array<{ result: unknown; error?: string }>;
  return json.map(r => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

// ─── 검증 ────────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];
function record(label: string, isOk: boolean) {
  if (isOk) passed.push(label);
  else failed.push(label);
}

// 1. PING
header('① 연결 확인 (PING)');
try {
  const t0 = Date.now();
  const pong = await redisCmd('PING');
  const latency = Date.now() - t0;

  if (pong === 'PONG') {
    ok(`PONG 수신. 지연: ${latency}ms`);
    record('PING', true);

    if (latency > 300) {
      warn(`지연이 ${latency}ms로 다소 높습니다. 리전이 한국/아시아로 설정되어 있는지 확인하십시오.`);
      warn('  Upstash 콘솔 → 데이터베이스 → Region (ap-northeast-1 또는 ap-northeast-2 권장)');
    }
  } else {
    fail(`예상치 않은 응답: ${String(pong)}`);
    record('PING', false);
  }
} catch (e) {
  fail(`PING 실패: ${String(e)}`);
  fail('URL과 TOKEN을 확인하십시오. Vercel 마켓플레이스 연동 후 vercel env pull로 가져올 수 있습니다.');
  record('PING', false);
  process.exit(1);
}

// 2. 기본 SET / GET / DEL
header('② 기본 동작 (SET · GET · DEL)');
try {
  const testValue = `verify_${Date.now()}`;

  await redisCmd('SET', TEST_KEY, testValue, 'EX', 60);
  const got = await redisCmd<string>('GET', TEST_KEY);

  if (got === testValue) {
    ok(`SET → GET 일치 확인 (키: ${TEST_KEY})`);
    record('SET/GET', true);
  } else {
    fail(`SET한 값과 GET한 값이 다릅니다. got="${got}"`);
    record('SET/GET', false);
  }

  await redisCmd('DEL', TEST_KEY);
  const afterDel = await redisCmd('GET', TEST_KEY);
  if (afterDel === null) {
    ok('DEL 후 GET → null 확인');
    record('DEL', true);
  } else {
    fail(`DEL 후에도 값이 남아 있습니다: "${afterDel}"`);
    record('DEL', false);
  }
} catch (e) {
  fail(`SET/GET/DEL 실패: ${String(e)}`);
  record('SET/GET', false);
}

// 3. INCRBY + EXPIRE — 오피넷 예산 카운터 패턴
header('③ 예산 카운터 패턴 (INCRBY · EXPIRE)');
{
  /*
   * 실제 운영 패턴:
   *   INCRBY opinet:budget:{date} {n}   → 오늘 사용량 누적
   *   EXPIRE opinet:budget:{date} 93600  → 26시간 후 자동 삭제
   *
   * 원자성 보장:
   *   여러 서버리스 인스턴스가 동시에 INCRBY를 호출해도
   *   Redis가 원자적으로 처리하므로 카운터가 정확합니다.
   */
  try {
    await redisCmd('DEL', BUDGET_KEY); // 기존 값 초기화

    // 시뮬레이션: 3번 호출, 각 13회 (기본 검색 1건)
    const [r1, r2, r3] = await Promise.all([
      redisCmd<number>('INCRBY', BUDGET_KEY, 13),
      redisCmd<number>('INCRBY', BUDGET_KEY, 13),
      redisCmd<number>('INCRBY', BUDGET_KEY, 13),
    ]);

    const total = await redisCmd<number>('GET', BUDGET_KEY);
    await redisCmd('EXPIRE', BUDGET_KEY, 60); // 테스트이므로 60초 후 삭제

    // 원자성 확인: 세 호출의 합이 39여야 함
    const sum = Number(total);
    if (sum === 39) {
      ok(`동시 INCRBY 원자성 확인: 13×3 = ${sum} (반환값: ${r1}, ${r2}, ${r3})`);
      record('INCRBY 원자성', true);
    } else {
      fail(`카운터 불일치: 기대 39, 실제 ${sum}. 동시성 문제 가능성`);
      record('INCRBY 원자성', false);
    }

    // 임계값 초과 감지 패턴
    const BUDGET = 1300;
    const simulatedUsage = 1298;
    await redisCmd('SET', BUDGET_KEY, simulatedUsage);
    const afterIncrby = await redisCmd<number>('INCRBY', BUDGET_KEY, 13);
    const exceeded = Number(afterIncrby) > BUDGET;
    if (exceeded) {
      ok(`예산 초과 감지 정상: ${simulatedUsage} + 13 = ${afterIncrby} > ${BUDGET}`);
      record('예산 초과 감지', true);
    } else {
      fail('예산 초과 감지 실패');
      record('예산 초과 감지', false);
    }

    await redisCmd('DEL', BUDGET_KEY);
  } catch (e) {
    fail(`INCRBY 테스트 실패: ${String(e)}`);
    record('INCRBY 원자성', false);
  }
}

// 4. 파이프라인 — 여러 캐시 조회의 왕복 성능
header('④ 파이프라인 성능 (여러 캐시 조회)');
{
  /*
   * 실제 검색은 기본 경로·장소·Valhalla 경로 캐시를 사용하며 후보 수와 적중률에 따라
   * 명령 수가 달라집니다. 여기서는 10회 파이프라인 자체의 왕복 동작만 확인합니다.
   *
   * 여기서는 10회 파이프라인으로 지연을 측정합니다.
   */
  const PIPE_COUNT = 10;
  const pipeKeys = Array.from({ length: PIPE_COUNT }, (_, i) => `${TEST_KEY}:pipe:${i}`);

  try {
    const setCommands = pipeKeys.map(k => ['SET', k, 'v', 'EX', '60']);
    const t0 = Date.now();
    await redisPipeline(setCommands);
    const getCommands = pipeKeys.map(k => ['GET', k]);
    const results = await redisPipeline(getCommands) as string[];
    const latency = Date.now() - t0;

    const allMatch = results.every(v => v === 'v');
    if (allMatch) {
      ok(`${PIPE_COUNT}건 파이프라인 왕복: ${latency}ms`);
      if (latency < 200) {
        ok('캐시 계층 지연 허용 범위 이내');
      } else {
        warn(`${latency}ms — 서버리스 환경에서 캐시 계층이 병목이 될 수 있습니다.`);
        warn('  캐시가 없을 때 비해 얼마나 빠른지는 §5.3.1 용량 분석을 참고하십시오.');
      }
      record('파이프라인 동작', true);
    } else {
      fail('파이프라인 SET/GET 불일치');
      record('파이프라인 동작', false);
    }

    // 정리
    await redisPipeline(pipeKeys.map(k => ['DEL', k]));
  } catch (e) {
    fail(`파이프라인 테스트 실패: ${String(e)}`);
    record('파이프라인 동작', false);
  }
}

// ─── 월간 명령 수 한도 안내 ─────────────────────────────────────────────
header('⑤ 무료 티어 월간 명령 수 한도 안내 (자동 측정 불가)');

info('Upstash REST API로 사용량을 프로그래매틱하게 조회하는 방법이 없습니다.');
info('아래 방법으로 직접 확인하십시오.\n');
console.log('  1. https://console.upstash.com 로그인');
console.log('  2. 데이터베이스 선택 → "Usage" 탭');
console.log('  3. 월간 명령 사용량과 현재 플랜 한도 확인\n');
console.log('  무료 티어 기준값 (2026-11 공식 가격표, 변경될 수 있음):');
console.log('  ┌───────────────────────────────────────────────────┐');
console.log('  │  월 500,000 명령 (무료)                           │');
console.log('  └───────────────────────────────────────────────────┘\n');

// 예상 명령 수 계산
const SEARCHES_PER_DAY  = 38; // 소규모 베타 부하 예시
const REDIS_PER_SEARCH  = 30; // 후보 수가 중간 정도인 검색의 보수적 예시
const REDIS_PER_SEARCH_HIT = 5; // 캐시 히트 가정
const HIT_RATE          = 0.5; // 초기 히트율 50% 가정

const expectedCmds = SEARCHES_PER_DAY *
  (REDIS_PER_SEARCH * (1 - HIT_RATE) + REDIS_PER_SEARCH_HIT * HIT_RATE);
const expectedMonthlyCmds = expectedCmds * 30;

console.log('  예상 하루 명령 수 계산:');
console.log(`  ┌────────────────────────────────────────────────────`);
console.log(`  │  검색 ${SEARCHES_PER_DAY}건/일 × [캐시 미스 ${REDIS_PER_SEARCH}회 × ${(1-HIT_RATE)*100}%`);
console.log(`  │              + 캐시 히트 ${REDIS_PER_SEARCH_HIT}회 × ${HIT_RATE*100}%]`);
console.log(`  │  = 약 ${Math.ceil(expectedCmds).toLocaleString()}회/일`);
console.log(`  │  = 30일 기준 약 ${Math.ceil(expectedMonthlyCmds).toLocaleString()}회/월`);
console.log(`  └────────────────────────────────────────────────────`);

if (expectedMonthlyCmds < 400_000) {
  ok(`예상 명령 수 ${Math.ceil(expectedMonthlyCmds)}회/월 < 무료 한도 500,000회/월 — 여유 있음`);
  info('단, 캐시 히트율이 낮거나 검색 건수가 늘면 초과할 수 있습니다.');
  info('콘솔에서 실제 사용량을 주기적으로 모니터링하십시오.');
} else {
  warn(`예상 명령 수 ${Math.ceil(expectedMonthlyCmds)}회/월 — 무료 한도에 근접하거나 초과할 수 있습니다.`);
  warn('캐시 TTL을 늘리거나 파이프라인을 적극 사용해 명령 수를 줄이십시오.');
}

// ─── 결과 ─────────────────────────────────────────────────────────────────
const allPassed = summary(passed, failed);

console.log('\n── 다음 단계 ──────────────────────────────────────────');
if (allPassed) {
  ok('Upstash Redis 검증 완료.');
  info('infra/cache/redis.ts 구현 시 UPSTASH_REDIS_REST_URL + TOKEN 환경변수를 사용하십시오.');
  info('예산 카운터는 INCRBY + EXPIRE(26시간) 패턴을 그대로 사용하면 됩니다.');
} else {
  warn('실패한 항목을 해결한 뒤 관련 Redis 캐시·예산 카운터를 변경하기 전에 다시 실행하십시오.');
}

process.exit(allPassed ? 0 : 1);
