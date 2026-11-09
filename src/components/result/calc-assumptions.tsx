"use client";

/**
 * 계산 전제 표시 — PRODUCT.md §5.3 ⑤, AGENTS.md §6 (제거 금지).
 * 기준가·연비·주유량을 밝히지 않은 절감액은 과장 광고이므로 항상 함께 보여준다.
 * "수정"은 재요청 없이 클라이언트에서 즉시 재계산한다(§10 Phase 9 완료 기준).
 * 허용 우회 거리는 표시 필터라 여기가 아니라 필터 시트에 있다 (§5.3 ⑥).
 */
import { useState } from "react";
import { Fuel, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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

export function CalcAssumptions({
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
    <Drawer
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
                  embeddedDivider && "border-t border-route-strong/20",
                  embeddedInset ? "px-4" : "px-0 py-0",
                )
              : "flex items-center justify-between gap-3 rounded-card border border-route-strong/15 bg-surface px-4 py-3 shadow-route-sm",
            className,
          )}
        >
          {embedded ? (
            <div className="flex min-w-0 items-center">
              <span className="flex size-8 shrink-0 items-center justify-center">
                <Fuel className="size-3.5 text-text-body" aria-hidden />
              </span>
              <p className="min-w-0 truncate text-xs text-text-body tabular-nums">
                {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유
                {referenceSummary ? ` · ${referenceSummary}` : ""}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="mt-0.5 truncate text-sm text-text-body tabular-nums">
                연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유
              </p>
              {referenceSummary && (
                <p className="mt-1.5 truncate text-sm text-text-body tabular-nums">
                  {referenceSummary}
                </p>
              )}
            </div>
          )}
          <DrawerTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "shrink-0 border border-border bg-surface text-text-body hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue",
                  embedded && "px-2 text-xs",
                )}
                style={{ height: embedded ? "25px" : undefined }}
                aria-label="기준 수정"
              />
            }
          >
            수정
          </DrawerTrigger>
        </div>
      ) : title ? (
        <div className={cn("flex flex-col text-sm text-text-body", className)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text-strong">
              {title}
            </h2>
            <DrawerTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-border bg-surface px-2 text-xs text-text-body hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue"
                  style={{ height: "25px" }}
                  aria-label="계산 기준 수정"
                  title="계산 기준 수정"
                />
              }
            >
              수정
            </DrawerTrigger>
          </div>

          <div className="mt-3 w-full">
            <dl className="min-w-0 space-y-2">
              {fuel != null && avoidHighway != null && (
                <div className="flex items-start justify-between gap-3">
                  <dt>연료 · 도로</dt>
                  <dd className="text-right text-text-strong">
                    {FUEL_LABEL[fuel]} ·{" "}
                    {avoidHighway ? "고속도로 회피" : "고속도로 포함"}
                  </dd>
                </div>
              )}
              {fuel != null && avoidHighway != null ? (
                <div className="flex items-start justify-between gap-3">
                  <dt>연비 · 주유량</dt>
                  <dd className="text-right text-text-strong tabular-nums">
                    {vehicle.efficiency}km/L · {vehicle.refuelAmount}L
                  </dd>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <dt>연비</dt>
                    <dd className="text-right text-text-strong tabular-nums">
                      {vehicle.efficiency}km/L
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>주유량</dt>
                    <dd className="text-right text-text-strong tabular-nums">
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
                  <dd className="text-right text-text-strong tabular-nums">
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
            "flex items-center justify-between border-t border-route-strong/20 px-3 py-2 text-sm text-text-body",
            className,
          )}
        >
          <span>
            {referenceSummary ? `${referenceSummary} · ` : ""}
            연비 {vehicle.efficiency}km/L · {vehicle.refuelAmount}L 주유 기준
          </span>
          <DrawerTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="border border-border bg-surface text-text-body hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue"
                aria-label="계산 기준 수정"
                title="계산 기준 수정"
              />
            }
          >
            <Pencil className="size-4" aria-hidden />
          </DrawerTrigger>
        </div>
      )}

      <DrawerContent className="h-auto rounded-t-card border-route-strong/15 bg-surface sm:mx-auto sm:max-w-md">
        <DrawerHeader className="flex min-h-16 flex-row items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-4 text-left">
          <DrawerTitle className="text-text-strong">기준 수정</DrawerTitle>
          <DrawerClose
            render={
              <button
                type="button"
                aria-label="기준 수정 닫기"
                className="-my-1 flex size-11 items-center justify-center rounded-control-sm text-text-body hover:bg-route-sky hover:text-route-blue focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-route-blue/30"
              />
            }
          >
            <X className="size-6" aria-hidden />
          </DrawerClose>
        </DrawerHeader>

        <div className="flex flex-col gap-3 bg-surface px-4 pb-5 pt-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-strong">
            연비 (km/L)
            <input
              type="number"
              step="0.1"
              min="1"
              inputMode="decimal"
              className="rounded-control-sm border border-border bg-surface px-3 py-2.5 text-text-strong outline-none placeholder:text-text-muted focus:border-brand-amber-strong focus:ring-2 focus:ring-brand-amber/30"
              value={draft.efficiency}
              onChange={(e) =>
                setDraft({ ...draft, efficiency: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-strong">
            주유량 (L)
            <input
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              className="rounded-control-sm border border-border bg-surface px-3 py-2.5 text-text-strong outline-none placeholder:text-text-muted focus:border-brand-amber-strong focus:ring-2 focus:ring-brand-amber/30"
              value={draft.refuelAmount}
              onChange={(e) =>
                setDraft({ ...draft, refuelAmount: e.target.value })
              }
            />
          </label>
        </div>

        <DrawerFooter className="border-t border-border bg-surface-quiet/70 p-4 pt-3">
          <DrawerClose
            render={
              <Button
                size="xl"
                className="w-full bg-brand-amber text-brand-amber-foreground hover:bg-brand-amber-strong"
                disabled={!canApply}
                onClick={() => {
                  if (!canApply) return;
                  onChangeVehicle({
                    efficiency: draftEfficiency,
                    refuelAmount: draftRefuelAmount,
                  });
                }}
              />
            }
          >
            적용
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
