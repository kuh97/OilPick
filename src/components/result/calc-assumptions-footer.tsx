"use client";

/**
 * 계산 전제 표시 — PRODUCT.md §5.3 ⑤, AGENTS.md §6 (제거 금지).
 * 기준가·연비·주유량을 밝히지 않은 절감액은 과장 광고이므로 항상 함께 보여준다.
 * "수정"은 재요청 없이 클라이언트에서 즉시 재계산한다(§10 Phase 9 완료 기준).
 *
 * "최대 우회 시간"은 계산 전제가 아니라 표시 필터다(PRODUCT.md §5.2) — 값을 바꿔도
 * 금액이 재계산되지 않고, 이미 받은 후보 목록에서 넘는 것만 걸러진다. 같은 다이얼로그에
 * 묶은 건 순전히 UI 편의고("이미 있는 재요청-없는-즉시-반영 다이얼로그 재사용"),
 * 구분이 흐려지지 않도록 별도 섹션으로 나눈다.
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
  maxDetourMinutes,
  onChangeMaxDetourMinutes,
}: {
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  vehicle: WireVehicle;
  onChangeVehicle: (vehicle: Partial<WireVehicle>) => void;
  maxDetourMinutes: number;
  onChangeMaxDetourMinutes: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState(vehicle);
  const [maxDetourDraft, setMaxDetourDraft] = useState(maxDetourMinutes);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
      <span>
        {referencePrice != null && refPriceSource != null
          ? `${SOURCE_LABEL[refPriceSource]} ${referencePrice.toLocaleString()}원/L 대비`
          : "기준가 산출 불가 — 가격순 정렬"}
        {" · "}연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유 기준
        {" · "}최대 {maxDetourMinutes}분 우회까지 표시
      </span>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setDraft(vehicle);
            setMaxDetourDraft(maxDetourMinutes);
          }
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

          <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">최대 우회 시간 (분)</span>
              <input
                type="number"
                step="5"
                min="1"
                className="rounded-lg border border-border px-3 py-2"
                value={maxDetourDraft}
                onChange={(e) => setMaxDetourDraft(Number(e.target.value))}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              이보다 오래 걸리는 우회는 목록에서 숨겨요. 금액 계산에는 영향을 주지 않아요.
            </p>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  onClick={() => {
                    onChangeVehicle(draft);
                    onChangeMaxDetourMinutes(maxDetourDraft);
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
