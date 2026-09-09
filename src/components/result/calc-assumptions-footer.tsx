"use client";

/**
 * 계산 전제 표시 — PRODUCT.md §5.3 ⑤, AGENTS.md §6 (제거 금지).
 * 기준가·연비·주유량을 밝히지 않은 절감액은 과장 광고이므로 항상 함께 보여준다.
 * "수정"은 재요청 없이 클라이언트에서 즉시 재계산한다(§10 Phase 9 완료 기준).
 * 우회 허용 시간은 표시 필터라 여기가 아니라 필터 시트에 있다 (§5.3 ⑥).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import type { RefPriceSource, WireVehicle } from "@/app/api/_lib/types";

const SOURCE_LABEL: Record<RefPriceSource, string> = {
  MEDIAN_T1T2: "경로 주변 중앙값",
  SIGUNGU_AVG: "지역 평균",
};

export function CalcAssumptionsFooter({
  referencePrice,
  refPriceSource,
  vehicle,
  onChangeVehicle,
}: {
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  vehicle: WireVehicle;
  onChangeVehicle: (vehicle: Partial<WireVehicle>) => void;
}) {
  const [draft, setDraft] = useState(vehicle);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
      <span>
        {referencePrice != null && refPriceSource != null
          ? `${SOURCE_LABEL[refPriceSource]} ${referencePrice.toLocaleString()}원/L 대비`
          : "기준가 산출 불가 — 가격순 정렬"}
        {" · "}연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유 기준
      </span>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft(vehicle);
        }}
      >
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>수정</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>계산 전제 수정</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              연비 (km/L)
              <input
                type="number"
                step="0.1"
                min="1"
                className="rounded-lg border border-border px-3 py-2"
                value={draft.efficiency}
                onChange={(e) => setDraft({ ...draft, efficiency: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              주유량 (L)
              <input
                type="number"
                step="1"
                min="1"
                className="rounded-lg border border-border px-3 py-2"
                value={draft.refuelAmount}
                onChange={(e) => setDraft({ ...draft, refuelAmount: Number(e.target.value) })}
              />
            </label>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  onClick={() => {
                    onChangeVehicle(draft);
                    setOpen(false);
                  }}
                />
              }
            >
              적용
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
