/**
 * 우회 고지 배너 — PRODUCT.md §5.3 ②, AGENTS.md §6 (제거 금지).
 * "이 문장이 뜨는 순간이 곧 제품의 존재 이유" — 사용자가 선택한 범위에서
 * 우회 가능한 후보까지 함께 보고 있음을 알린다.
 *
 * 사용자가 우회 거리를 선택하고 STAGE 2 최종 목록에 우회 후보가 남았을 때 켜진다.
 * 실제로 채택된 후보의 도달 거리(finalRadiusM)를 km로 올림해 문구를 구성한다.
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
  const distanceKm = Math.ceil(expansion.finalRadiusM / 1000);

  return (
    <Alert
      variant="default"
      className="rounded-card border border-route-blue/25 bg-route-sky text-route-blue"
    >
      <Info className="size-4 text-route-blue" aria-hidden />
      <AlertDescription className="text-wrap text-xs leading-5 text-route-blue">
        경로에서 {distanceKm}km 떨어진 곳까지 살펴, 우회 가능한 {stationWord}도
        함께 보여드려요.
      </AlertDescription>
    </Alert>
  );
}
