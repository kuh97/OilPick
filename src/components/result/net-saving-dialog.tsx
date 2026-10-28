"use client";

import { CircleQuestionMark } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function formatSignedWon(amountWon: number): string {
  if (amountWon === 0) return "0원";
  return `${amountWon > 0 ? "+" : ""}${amountWon.toLocaleString()}원`;
}

export function NetSavingDialog({
  netSavingWon,
  priceSavingWon,
  detourFuelCostWon,
  finalLabel,
  dialogTitle,
  unavailableMessage,
  calculationNote = "상세에서 실제 경로 기준으로 다시 계산해요.",
}: {
  netSavingWon: number;
  priceSavingWon: number | null;
  detourFuelCostWon: number;
  finalLabel: string;
  dialogTitle: string;
  unavailableMessage: string;
  calculationNote?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto text-text-body hover:bg-route-sky hover:text-route-strong"
            aria-label={dialogTitle}
            title={dialogTitle}
          />
        }
      >
        <CircleQuestionMark className="size-3.5" aria-hidden />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            기준가 대비 주유비에서 우회 연료비를 뺀 금액이에요.
          </DialogDescription>
        </DialogHeader>

        {priceSavingWon == null ? (
          <p className="text-sm text-text-body">{unavailableMessage}</p>
        ) : (
          <>
            <div className="space-y-2 rounded-control bg-route-sky/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-body">기준가 대비 주유비</span>
                <span className="font-route font-semibold text-text-strong">
                  {formatSignedWon(priceSavingWon)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-body">우회 연료비</span>
                <span className="font-route font-semibold text-text-strong">
                  {detourFuelCostWon > 0
                    ? `-${detourFuelCostWon.toLocaleString()}원`
                    : "0원"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-route-strong/15 pt-2">
                <span className="font-semibold text-text-strong">최종 금액</span>
                <span
                  className={`font-route font-bold ${
                    netSavingWon > 0
                      ? "text-success-foreground"
                      : "text-text-body"
                  }`}
                >
                  {finalLabel}
                </span>
              </div>
            </div>
            <p className="text-xs leading-5 text-text-body">
              <span className="block">
                예상 우회거리 기준으로 계산하며, 시간·통행료는 포함하지 않아요.
              </span>
              <span className="mt-1 block">{calculationNote}</span>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
