"use client";

/**
 * 필터 시트(F2·F6) — §5.2. 시설·브랜드·품질·셀프·우회 허용 시간.
 * 내 주변 화면에서는 우회 허용 시간만 숨기고 나머지 필터 UI를 재사용한다.
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
import { MaxDetourBar } from "@/components/result/max-detour-bar";
import { DEFAULT_MAX_DETOUR_MINUTES } from "@/domain/params";
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

type BaseFilterSheetProps = {
  filters: WireFilters;
  onApply: (filters: WireFilters) => void;
};

type FilterSheetProps =
  | (BaseFilterSheetProps & {
      /** 생략하면 결과 화면용으로 우회 허용 시간 필터를 표시한다. */
      includeDetour?: true;
      maxDetourMinutes: number;
      maxDetourCeiling: number;
      /** draft가 실제로 바뀌었을 때만 호출 — page.tsx가 이걸 STAGE 2 재검색으로 해석한다. */
      onApplyMaxDetourMinutes: (minutes: number) => void;
    })
  | (BaseFilterSheetProps & {
      includeDetour: false;
    });

export function FilterSheet(props: FilterSheetProps) {
  const { filters, onApply } = props;
  const detourProps = props.includeDetour === false ? null : props;
  const [draft, setDraft] = useState(filters);
  const clampedMax = detourProps
    ? Math.min(detourProps.maxDetourMinutes, detourProps.maxDetourCeiling)
    : 0;
  const [maxDetourDraft, setMaxDetourDraft] = useState(clampedMax);

  return (
    <Drawer
      onOpenChange={(open) => {
        if (open) {
          // 열 때마다 현재 적용된 값으로 초기화
          setDraft(filters);
          if (detourProps) setMaxDetourDraft(clampedMax);
        }
      }}
    >
      <DrawerTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="border-route-strong/20 bg-surface text-text-strong hover:border-route-strong hover:bg-route-sky hover:text-route-strong"
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
            className="text-sm text-text-body underline underline-offset-2 hover:text-route-strong"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              if (detourProps) {
                setMaxDetourDraft(
                  Math.min(DEFAULT_MAX_DETOUR_MINUTES, detourProps.maxDetourCeiling),
                );
              }
            }}
          >
            초기화
          </button>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain bg-surface px-4 pb-4 pt-4 touch-pan-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {detourProps && (
            <MaxDetourBar
              value={maxDetourDraft}
              ceilingMinutes={detourProps.maxDetourCeiling}
              onChange={setMaxDetourDraft}
            />
          )}

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
                        ? "border-route-strong bg-route-sky text-route-strong shadow-route-sm"
                        : "border-route-strong/15 bg-surface-quiet/60 text-text-body hover:border-route-strong hover:bg-route-sky hover:text-route-strong",
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
              <span className="font-semibold text-text-strong">셀프 주유소만</span>
              <Switch
                checked={draft.selfOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, selfOnly: Boolean(checked) }))
                }
              />
            </label>
            <label className="flex items-center justify-between bg-surface px-4 py-3 text-sm text-text-body">
              <span className="font-semibold text-text-strong">품질인증 주유소만</span>
              <Switch
                checked={draft.kpetroOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, kpetroOnly: Boolean(checked) }))
                }
              />
            </label>
          </section>

          <p className="text-xs leading-5 text-text-body">
            바꾼 뒤 &apos;적용&apos;을 누르면 조건에 맞는 주유소를 다시 찾아요.
            <br />
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
                  // 실제로 건드렸을 때만 — 안 건드린 필터 적용이 STAGE 2로 튕기지 않게.
                  if (detourProps && maxDetourDraft !== clampedMax) {
                    detourProps.onApplyMaxDetourMinutes(maxDetourDraft);
                  }
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
