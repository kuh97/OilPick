/**
 * 우회 고지 배너 — PRODUCT.md §5.3 ②, AGENTS.md §6 (제거 금지).
 * "이 문장이 뜨는 순간이 곧 제품의 존재 이유" — 기존 서비스가 검색 결과 없음으로
 * 끝냈을 순간에 우회해서라도 찾아줬다는 걸 알린다.
 *
 * STAGE 1에서 경로상 후보가 없을 때만 T3_MAX 회랑으로 확장하며, STAGE 2 최종 목록에
 * 우회 후보가 남았을 때 켜진다. 실제로 채택된 후보의 도달 거리(finalRadiusM)로 문구를 구성한다.
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
      className="rounded-card border border-route-blue/25 bg-route-sky text-route-blue"
    >
      <Info className="size-4 text-route-blue" aria-hidden />
      <AlertDescription className="text-wrap text-xs leading-5 text-route-blue">
        경로 주변에 조건에 맞는 {stationWord}가 적어 {km}km까지 넓혀 찾았어요.
      </AlertDescription>
    </Alert>
  );
}
