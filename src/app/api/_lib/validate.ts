/**
 * 요청 바디/쿼리 파싱 공용 헬퍼. 실패 시 일관된 400 응답을 만듭니다.
 * 라우트 핸들러에 zod 에러 포매팅이 반복해서 섞이지 않게 합니다.
 */

import { NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";

export interface ParseFailure {
  ok: false;
  response: NextResponse;
}

export interface ParseSuccess<T> {
  ok: true;
  data: T;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function invalidRequest(message: string): NextResponse {
  return NextResponse.json({ code: "INVALID_REQUEST", message }, { status: 400 });
}

// Input을 T로 못박지 않는다 — SearchRequestSchema처럼 .default()를 쓰는 필드가 있으면
// Input(파싱 전, optional)과 Output(파싱 후, T)이 달라져 ZodType<T>(Input=T 기본값)로
// 받을 때 T가 어정쩡하게 넓어진다 (avoidHighway가 `boolean | undefined`로 새는 문제).
export async function parseJsonBody<T>(request: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<ParseResult<T>> {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return { ok: false, response: invalidRequest("요청 본문이 올바른 JSON이 아닙니다.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: invalidRequest(parsed.error.message) };
  }
  return { ok: true, data: parsed.data };
}

export function parseSearchParams<T>(url: URL, schema: ZodType<T, ZodTypeDef, unknown>): ParseResult<T> {
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return { ok: false, response: invalidRequest(parsed.error.message) };
  }
  return { ok: true, data: parsed.data };
}
