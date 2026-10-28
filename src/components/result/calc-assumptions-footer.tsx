"use client";

/**
 * 계산 전제 표시 — PRODUCT.md §5.3 ⑤, AGENTS.md §6 (제거 금지).
 * 기준가·연비·주유량을 밝히지 않은 절감액은 과장 광고이므로 항상 함께 보여준다.
 * "수정"은 재요청 없이 클라이언트에서 즉시 재계산한다(§10 Phase 9 완료 기준).
 * 우회 허용 시간은 표시 필터라 여기가 아니라 필터 시트에 있다 (§5.3 ⑥).
 */
import { useState } from "react";
import { Fuel, Pencil } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type {
  Fuel as FuelType,
  RefPriceSource,
  WireVehicle,
} from "@/app/api/_lib/types";

const SOURCE_LABEL: Record<RefPriceSource, string> = {
  MEDIAN_T1T2: "경로 주변 중앙값",
  SIGUNGU_AVG: "지역 평균",
};

const FUEL_LABEL: Record<FuelType, string> = {
  GASOLINE: "휘발유",
  DIESEL: "경유",
  LPG: "LPG",
};

type VehicleDraft = Omit<WireVehicle, "efficiency" | "refuelAmount"> & {
  efficiency: string;
  refuelAmount: string;
};

function toVehicleDraft(vehicle: WireVehicle): VehicleDraft {
  return {
    ...vehicle,
    efficiency: String(vehicle.efficiency),
    refuelAmount: String(vehicle.refuelAmount),
  };
}

export function CalcAssumptionsFooter({
  referencePrice,
  refPriceSource,
  vehicle,
  onChangeVehicle,
  className,
  title,
  compact = false,
  embedded = false,
  embeddedDivider = true,
  embeddedInset = true,
  fuel,
  avoidHighway,
}: {
  referencePrice: number | null;
  refPriceSource: RefPriceSource | null;
  vehicle: WireVehicle;
  onChangeVehicle: (vehicle: Partial<WireVehicle>) => void;
  className?: string;
  title?: string;
  compact?: boolean;
  embedded?: boolean;
  embeddedDivider?: boolean;
  embeddedInset?: boolean;
  fuel?: FuelType;
  avoidHighway?: boolean;
}) {
  const [draft, setDraft] = useState<VehicleDraft>(() =>
    toVehicleDraft(vehicle),
  );
  const [open, setOpen] = useState(false);
  const draftEfficiency = Number(draft.efficiency);
  const draftRefuelAmount = Number(draft.refuelAmount);
  const canApply =
    draft.efficiency.trim() !== "" &&
    draft.refuelAmount.trim() !== "" &&
    Number.isFinite(draftEfficiency) &&
    draftEfficiency >= 1 &&
    Number.isFinite(draftRefuelAmount) &&
    draftRefuelAmount >= 1;
  const referenceSummary =
    referencePrice != null
      ? `${refPriceSource != null ? SOURCE_LABEL[refPriceSource] : "가격 기준"} ${referencePrice.toLocaleString()}원/L`
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(toVehicleDraft(vehicle));
      }}
    >
      {compact ? (
        <div
          className={cn(
            embedded
              ? cn(
                  "flex items-center justify-between gap-3 py-1.5",
                  embeddedDivider && "border-t border-route-sky",
                  embeddedInset ? "px-4" : "px-0 py-0",
                )
              : "flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3",
            className,
          )}
        >
          {embedded ? (
            <div className="flex min-w-0 items-center">
              <span className="flex size-8 shrink-0 items-center justify-center">
                <Fuel className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
                {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유
                {referenceSummary ? ` · ${referenceSummary}` : ""}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">
                연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유
              </p>
              {referenceSummary && (
                <p className="mt-1.5 truncate text-sm text-muted-foreground tabular-nums">
                  {referenceSummary}
                </p>
              )}
            </div>
          )}
          <DialogTrigger
            render={
              <Button
                variant={embedded ? "ghost" : "outline"}
                size="sm"
                className={cn(
                  "shrink-0",
                  embedded && "h-auto px-1.5 text-xs text-primary",
                )}
                aria-label="기준 수정"
              />
            }
          >
            수정
          </DialogTrigger>
        </div>
      ) : title ? (
        <div
          className={cn(
            "flex flex-col text-sm text-muted-foreground",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1.5 text-xs text-primary"
                  aria-label="계산 기준 수정"
                  title="계산 기준 수정"
                />
              }
            >
              수정
            </DialogTrigger>
          </div>

          <div className="mt-3 w-full">
            <dl className="min-w-0 space-y-2">
              {fuel != null && avoidHighway != null && (
                <div className="flex items-start justify-between gap-3">
                  <dt>연료 · 도로</dt>
                  <dd className="text-right text-foreground">
                    {FUEL_LABEL[fuel]} ·{" "}
                    {avoidHighway ? "고속도로 회피" : "고속도로 포함"}
                  </dd>
                </div>
              )}
              {fuel != null && avoidHighway != null ? (
                <div className="flex items-start justify-between gap-3">
                  <dt>연비 · 주유량</dt>
                  <dd className="text-right text-foreground tabular-nums">
                    {vehicle.efficiency}km/L · {vehicle.refuelAmount}L
                  </dd>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <dt>연비</dt>
                    <dd className="text-right text-foreground tabular-nums">
                      {vehicle.efficiency}km/L
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>주유량</dt>
                    <dd className="text-right text-foreground tabular-nums">
                      {vehicle.refuelAmount}L
                    </dd>
                  </div>
                </>
              )}
              {referenceSummary && (
                <div className="flex items-start justify-between gap-3">
                  <dt>
                    {refPriceSource != null
                      ? SOURCE_LABEL[refPriceSource]
                      : "가격 기준"}
                  </dt>
                  <dd className="text-right text-foreground tabular-nums">
                    {referencePrice!.toLocaleString()}원/L
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground",
            className,
          )}
        >
          <span>
            {referenceSummary ? `${referenceSummary} · ` : ""}
            연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유 기준
          </span>
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="계산 기준 수정"
                title="계산 기준 수정"
              />
            }
          >
            <Pencil className="size-4" aria-hidden />
          </DialogTrigger>
        </div>
      )}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>기준 수정</DialogTitle>
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
              onChange={(e) =>
                setDraft({ ...draft, efficiency: e.target.value })
              }
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
              onChange={(e) =>
                setDraft({ ...draft, refuelAmount: e.target.value })
              }
            />
          </label>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button
                disabled={!canApply}
                onClick={() => {
                  if (!canApply) return;
                  onChangeVehicle({
                    efficiency: draftEfficiency,
                    refuelAmount: draftRefuelAmount,
                  });
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
  );
}
