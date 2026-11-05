"use client";

/**
 * 허용 우회 거리 설정 — 결과 화면의 검색 입력. PRODUCT.md §6.5·§6.6.
 * 값을 바꿀 때마다 검색하지 않고, 바텀시트에서 적용할 때 한 번만 재검색한다.
 */
import { useState } from "react";
import { ChevronRight, Route, X } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DETOUR_DISTANCE_STEPS_KM = [3, 5, 10, 15] as const;

export function DetourDistanceBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (distanceKm: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setDraftValue(value);
    setOpen(nextOpen);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DrawerTrigger
        render={
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 rounded-card border border-border bg-surface px-4 text-left shadow-route-sm transition-colors hover:border-route-blue/40 hover:bg-route-sky focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-route-blue/30"
          />
        }
      >
        <Route className="size-5 shrink-0 text-route-blue" aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-semibold text-text-strong">
          허용 우회 거리
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-route-blue">
          {value}km 이내
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-text-body"
          aria-hidden
        />
      </DrawerTrigger>

      <DrawerContent className="h-auto rounded-t-card border-route-strong/15 bg-surface sm:mx-auto sm:max-w-md">
        <DrawerHeader className="flex flex-row items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-4 !text-left">
          <DrawerTitle className="text-text-strong">허용 우회 거리</DrawerTitle>
          <DrawerClose
            render={
              <button
                type="button"
                aria-label="허용 우회 거리 닫기"
                className="rounded-control-sm p-1.5 text-text-body hover:bg-route-sky hover:text-route-blue focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-route-blue/30"
              />
            }
          >
            <X className="size-6" aria-hidden />
          </DrawerClose>
        </DrawerHeader>

        <div className="flex flex-col gap-5 bg-surface px-5 pb-5 pt-5">
          <div
            role="group"
            aria-label="허용 우회 거리 선택"
            className="grid grid-cols-2 gap-3"
          >
            {DETOUR_DISTANCE_STEPS_KM.map((step) => {
              const selected = step === draftValue;

              return (
                <button
                  key={step}
                  type="button"
                  aria-label={`${step} km 이내`}
                  aria-pressed={selected}
                  onClick={() => setDraftValue(step)}
                  className={cn(
                    "flex min-h-16 items-center justify-center gap-1 rounded-control-sm border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-route-blue/30",
                    selected
                      ? "border-route-blue/50 bg-route-sky text-route-blue shadow-route-sm"
                      : "border-route-strong/15 bg-surface text-text-body hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue",
                  )}
                >
                  <span className="text-lg font-bold tabular-nums">{step}</span>
                  <span>km 이내</span>
                </button>
              );
            })}
          </div>
        </div>

        <DrawerFooter className="border-t border-border bg-surface-quiet/70 p-4 pt-3">
          <DrawerClose
            render={
              <Button
                size="xl"
                className="w-full"
                onClick={() => {
                  if (draftValue !== value) onChange(draftValue);
                }}
              />
            }
          >
            적용하고 다시 검색
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
