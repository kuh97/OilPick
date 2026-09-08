/**
 * verify:coverage · verify:t3-rate · verify:uturn 공용 유틸 — 노선·연료 인자 파싱.
 *
 * Phase C(회랑 bbox 전환, MIGRATION-DB.md §7) 이후 이 세 스크립트는 오피넷을 전혀
 * 호출하지 않습니다 — 후보 조회가 refuel_point DB 쿼리 하나로 끝납니다. 그래서 이
 * 파일의 예전 역할이었던 "오피넷 300회/일 예산 보호"(confirmBudget·estimateSampleCount·
 * fetchStationsAtKatecPoint)는 더 이상 필요 없어 제거했습니다. 남은 카카오 호출(노선당
 * 1~7회)은 일 10,000건 쿼터 안에서 무시할 수준이라 --yes 확인 게이트도 없앴습니다
 * (verify:detour와 같은 관례).
 */

import type { Fuel } from "@/domain/types";

export const ALL_FUELS: Fuel[] = ["GASOLINE", "DIESEL", "LPG"];

function argv(): string[] {
  return process.argv.slice(2);
}

/** --fuel=LPG | --fuel=all. 기본값은 LPG (1순위 타깃, PRODUCT.md §1.5) */
export function parseFuelArg(): Fuel[] {
  const arg = argv().find((a) => a.startsWith("--fuel="));
  if (!arg) return ["LPG"];
  const value = arg.split("=")[1]?.toUpperCase();
  if (value === "ALL") return ALL_FUELS;
  if (value && (ALL_FUELS as string[]).includes(value)) return [value as Fuel];
  throw new Error(`알 수 없는 --fuel 값: ${arg}. LPG|GASOLINE|DIESEL|all 중 하나를 쓰십시오.`);
}

/** --route=0,2 | --route=all. 기본값은 all (ROUTES 배열 전체) */
export function parseRouteIndexArg(routeCount: number): number[] {
  const arg = argv().find((a) => a.startsWith("--route="));
  if (!arg) return Array.from({ length: routeCount }, (_, i) => i);
  const value = arg.split("=")[1];
  if (value === "all") return Array.from({ length: routeCount }, (_, i) => i);
  return value.split(",").map((v) => Number(v.trim()));
}
