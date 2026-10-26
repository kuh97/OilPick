"use client";

/**
 * 기준 모드 탭 — PRODUCT.md §5.3 ③·§8. 탭 전환은 클라이언트에서 기존 후보를
 * 재정렬할 뿐 API를 다시 부르지 않는다(ARCHITECTURE.md §10 Phase 9 완료 기준).
 */
import { cn } from "@/lib/utils";
import type { Mode } from "@/app/api/_lib/types";

const MODE_LABEL: Record<Mode, string> = {
  balanced: "추천",
  minCost: "최소비용",
  minDistance: "최단거리",
};

const MODES: Mode[] = ["balanced", "minCost", "minDistance"];

export function ModeTabs({ value, onChange }: { value: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="기준 모드">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "flex-1 rounded-md px-1.5 py-1.5 text-center text-xs font-medium whitespace-nowrap transition-colors sm:text-sm",
            value === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
