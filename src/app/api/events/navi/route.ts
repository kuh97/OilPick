/** 딥링크 클릭 기록 — ARCHITECTURE.md §6.4·§10 Phase 11. */

import { NaviEventSchema } from "@/app/api/_lib/schema";
import { parseJsonBody } from "@/app/api/_lib/validate";
import { logNaviClick } from "@/services/event-service";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, NaviEventSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await logNaviClick(parsed.data);
  } catch (error) {
    // 이벤트 기록 실패가 사용자의 내비게이션 실행을 막아서는 안 된다.
    console.error("[POST /api/events/navi] 이벤트 기록 실패:", error);
  }
  return new Response(null, { status: 204 });
}
