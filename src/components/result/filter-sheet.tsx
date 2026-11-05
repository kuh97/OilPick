"use client";

/**
 * 필터 시트(F2·F6) — §5.2. 시설·브랜드·품질·셀프.
 * 허용 우회 거리는 검색 입력이므로 결과 화면의 별도 컨트롤에서 바꾼다.
 */
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Facility, WireFilters } from "@/app/api/_lib/types";

const FACILITY_LABEL: Record<Facility, string> = {
  CAR_WASH: "세차장",
  MAINTENANCE: "경정비",
  CVS: "편의점",
};
const FACILITIES: Facility[] = ["CAR_WASH", "MAINTENANCE", "CVS"];

const EMPTY_FILTERS: WireFilters = {
  facilities: [],
  brands: [],
  kpetroOnly: false,
  selfOnly: false,
};

/** 오피넷 POLL_DIV_CD ↔ 표시명 — PRODUCT.md §5.2. RTO·RTX는 "알뜰" 하나로 묶는다. */
const BRAND_GROUPS: { label: string; codes: string[] }[] = [
  { label: "SK에너지", codes: ["SKE"] },
  { label: "GS칼텍스", codes: ["GSC"] },
  { label: "현대오일뱅크", codes: ["HDO"] },
  { label: "S-OIL", codes: ["SOL"] },
  { label: "알뜰", codes: ["RTO", "RTX"] },
  { label: "농협", codes: ["NHO"] },
  { label: "자가상표", codes: ["ETC"] },
  { label: "E1", codes: ["E1G"] },
  { label: "SK가스", codes: ["SKG"] },
];

type FilterSheetProps = {
  filters: WireFilters;
  onApply: (filters: WireFilters) => void;
};

export function FilterSheet({ filters, onApply }: FilterSheetProps) {
  const [draft, setDraft] = useState(filters);

  return (
    <Drawer
      onOpenChange={(open) => {
        if (open) {
          // 열 때마다 현재 적용된 값으로 초기화
          setDraft(filters);
        }
      }}
    >
      <DrawerTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="border-border bg-surface text-text-strong hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue"
          />
        }
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        필터
      </DrawerTrigger>
      <DrawerContent className="h-[min(76dvh,42rem)] rounded-t-card border-route-strong/15 bg-surface sm:mx-auto sm:h-auto sm:max-w-md">
        <DrawerHeader className="flex flex-row items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-4 text-left">
          <DrawerTitle className="text-text-strong">필터</DrawerTitle>
          <button
            type="button"
            className="text-sm text-text-body underline underline-offset-2 hover:text-route-blue"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
            }}
          >
            초기화
          </button>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain bg-surface px-4 pb-4 pt-4 touch-pan-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <section className="flex shrink-0 flex-col gap-2">
            <h3 className="text-sm font-semibold text-text-strong">시설</h3>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-route-strong/15">
              {FACILITIES.map((f) => (
                <label
                  key={f}
                  className="flex items-center justify-between bg-surface px-4 py-3 text-sm text-text-body"
                >
                  {FACILITY_LABEL[f]}
                  <Switch
                    checked={draft.facilities.includes(f)}
                    onCheckedChange={() =>
                      setDraft((d) => ({
                        ...d,
                        facilities: d.facilities.includes(f)
                          ? d.facilities.filter((x) => x !== f)
                          : [...d.facilities, f],
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="flex shrink-0 flex-col gap-2">
            <h3 className="text-sm font-semibold text-text-strong">브랜드</h3>
            <div className="flex flex-wrap gap-2">
              {BRAND_GROUPS.map((g) => {
                const isOn = g.codes.every((c) => draft.brands.includes(c));
                return (
                  <button
                    key={g.label}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        brands: isOn
                          ? d.brands.filter((b) => !g.codes.includes(b))
                          : [...new Set([...d.brands, ...g.codes])],
                      }))
                    }
                    className={cn(
                      "rounded-control-sm border px-3 py-1.5 text-sm font-medium transition-colors",
                      isOn
                        ? "border-route-blue/50 bg-route-sky text-route-blue shadow-route-sm"
                        : "border-route-strong/15 bg-surface-quiet/60 text-text-body hover:border-route-blue/40 hover:bg-route-sky hover:text-route-blue",
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex shrink-0 flex-col divide-y divide-border overflow-hidden rounded-card border border-route-strong/15">
            <label className="flex items-center justify-between bg-surface px-4 py-3 text-sm text-text-body">
              <span className="font-semibold text-text-strong">
                셀프 주유소만
              </span>
              <Switch
                checked={draft.selfOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, selfOnly: Boolean(checked) }))
                }
              />
            </label>
            <label className="flex items-center justify-between bg-surface px-4 py-3 text-sm text-text-body">
              <span className="font-semibold text-text-strong">
                품질인증 주유소만
              </span>
              <Switch
                checked={draft.kpetroOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, kpetroOnly: Boolean(checked) }))
                }
              />
            </label>
          </section>

          <p className="text-xs leading-5 text-text-body">
            운영시간 필터는 공공데이터에서 제공되지 않아 지원하지 않습니다.
          </p>
        </div>

        <DrawerFooter className="border-t border-border bg-surface-quiet/70 p-4 pt-3">
          <DrawerClose
            render={
              <Button
                size="xl"
                className="w-full"
                onClick={() => {
                  onApply(draft);
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
