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
    <div className="flex min-w-0 flex-1 gap-1 rounded-control bg-surface-quiet p-1" role="tablist" aria-label="기준 모드">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "min-h-10 flex-1 rounded-control-sm px-3 text-center text-sm font-medium whitespace-nowrap transition-colors",
            value === mode ? "bg-surface text-text-strong shadow-route-sm" : "text-text-body hover:text-text-strong",
          )}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
