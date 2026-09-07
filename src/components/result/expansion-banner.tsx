/**
 * 우회 고지 배너 — PRODUCT.md §5.3 ②, AGENTS.md §6 (제거 금지).
 * "이 문장이 뜨는 순간이 곧 제품의 존재 이유" — 기존 서비스가 검색 결과 없음으로
 * 끝냈을 순간에 우회해서라도 찾아줬다는 걸 알린다.
 *
 * 회랑 bbox 쿼리가 T3_MAX까지 한 번에 덮으므로, 최종 목록에 T3(d_perp > T2_MAX)가
 * 남았을 때만 켜진다. 확장 전 후보 수는 알 수 없어 도달한 반경(finalRadiusM)만으로
 * 정직하게 문구를 구성한다.
 */
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Fuel, WireExpansion } from "@/app/api/_lib/types";

export function ExpansionBanner({ expansion, fuel }: { expansion: WireExpansion; fuel: Fuel }) {
  if (!expansion.triggered) return null;

  const stationWord = fuel === "LPG" ? "충전소" : "주유소";
  const km = (expansion.finalRadiusM / 1000).toFixed(1).replace(/\.0$/, "");

  return (
    <Alert variant="info">
      <Info aria-hidden />
      <AlertDescription className="text-info-foreground">
        경로 주변에서 조건에 맞는 {stationWord}를 충분히 찾지 못해 {km}km까지 넓혀 찾았어요.
      </AlertDescription>
    </Alert>
  );
}
