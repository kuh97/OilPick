"use client";

/**
 * 필터 시트(F2·F6) — PRODUCT.md §5.2. 여기선 시설·브랜드·품질인증·셀프·우회 허용 시간.
 * "적용"을 눌러야 커밋된다. 시설·브랜드·품질·셀프는 서버가 후보 수집 시 걸러 바뀌면
 * 재검색되고(토글 즉시 반영은 예산 때문에 안 함), 우회 허용 시간은 받은 목록을 화면에서
 * 거르기만 한다 — 재검색 없음 (§5.3 ⑥).
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
import { DEFAULT_MAX_DETOUR_MINUTES } from "@/domain/params";
import { MaxDetourBar } from "@/components/result/max-detour-bar";
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

export function FilterSheet({
  filters,
  onApply,
  maxDetourMinutes,
  onApplyMaxDetourMinutes,
}: {
  filters: WireFilters;
  onApply: (filters: WireFilters) => void;
  maxDetourMinutes: number;
  onApplyMaxDetourMinutes: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [maxDetourDraft, setMaxDetourDraft] = useState(maxDetourMinutes);

  return (
    <Drawer
      onOpenChange={(open) => {
        if (open) {
          // 열 때마다 현재 적용된 값으로 초기화
          setDraft(filters);
          setMaxDetourDraft(maxDetourMinutes);
        }
      }}
    >
      <DrawerTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal className="size-3.5" aria-hidden />
        필터
      </DrawerTrigger>
      <DrawerContent className="sm:mx-auto sm:max-w-md">
        <DrawerHeader className="flex flex-row items-center justify-between">
          <DrawerTitle>필터</DrawerTitle>
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setMaxDetourDraft(DEFAULT_MAX_DETOUR_MINUTES);
            }}
          >
            초기화
          </button>
        </DrawerHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          <MaxDetourBar value={maxDetourDraft} onChange={setMaxDetourDraft} />

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">시설</h3>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
              {FACILITIES.map((f) => (
                <label
                  key={f}
                  className="flex items-center justify-between bg-card px-3.5 py-2.5 text-sm"
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

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">브랜드</h3>
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
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      isOn
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
            <label className="flex items-center justify-between bg-card px-3.5 py-2.5 text-sm">
              <span className="font-semibold">셀프 주유소만</span>
              <Switch
                checked={draft.selfOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, selfOnly: Boolean(checked) }))
                }
              />
            </label>
            <label className="flex items-center justify-between bg-card px-3.5 py-2.5 text-sm">
              <span className="font-semibold">품질인증 주유소만</span>
              <Switch
                checked={draft.kpetroOnly}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, kpetroOnly: Boolean(checked) }))
                }
              />
            </label>
          </section>

          <p className="text-xs text-muted-foreground">
            시설·브랜드·셀프·품질인증을 바꾸면 조건에 맞는 주유소를 다시 탐색해요. 우회 허용
            시간은 이미 찾은 목록에서 바로 걸러져요. 운영시간 필터는 공공데이터에서 제공되지
            않아 지원하지 않습니다.
          </p>
        </div>

        <DrawerFooter>
          <DrawerClose
            render={
              <Button
                size="xl"
                className="w-full"
                onClick={() => {
                  onApply(draft);
                  onApplyMaxDetourMinutes(maxDetourDraft);
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
