/**
 * 우회 고지 배너 — PRODUCT.md §5.3 ②, AGENTS.md §6 (제거 금지).
 * "이 문장이 뜨는 순간이 곧 제품의 존재 이유" — 기존 서비스가 검색 결과 없음으로
 * 끝냈을 순간에 우회해서라도 찾아줬다는 걸 알린다.
 *
 * 회랑 bbox 쿼리가 T3_MAX까지 한 번에 덮으므로, STAGE 2 최종 목록에 우회 후보가
 * 남았을 때 켜진다. 실제로 채택된 후보의 도달 거리(finalRadiusM)로 문구를 구성한다.
 */
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Fuel, WireExpansion } from "@/app/api/_lib/types";

export function ExpansionBanner({
  expansion,
  fuel,
}: {
  expansion: WireExpansion;
  fuel: Fuel;
}) {
  if (!expansion.triggered) return null;

  const stationWord = fuel === "LPG" ? "충전소" : "주유소";
  const km = (expansion.finalRadiusM / 1000).toFixed(1).replace(/\.0$/, "");

  return (
    <Alert
      variant="default"
      className="rounded-card border border-border bg-surface-quiet/70 text-text-body"
    >
      <Info className="size-4 text-text-muted" aria-hidden />
      <AlertDescription className="text-wrap text-xs leading-5 text-text-body">
        경로 주변에 조건에 맞는 {stationWord}가 적어 {km}km까지 넓혀 찾았어요.
      </AlertDescription>
    </Alert>
  );
}
