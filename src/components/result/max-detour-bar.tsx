"use client";

/**
 * "우회 허용 시간" 세그먼트 바 (0~30분·5분 단위) — PRODUCT.md §5.3 ⑥.
 * FilterSheet(§5.2) 안에서 쓴다. 값이 30 이상이면 30 세그먼트를 활성 표시.
 */
import { cn } from "@/lib/utils";

export const MAX_DETOUR_STEPS = [0, 5, 10, 15, 20, 25, 30] as const;
const CEIL = MAX_DETOUR_STEPS[MAX_DETOUR_STEPS.length - 1];

export function MaxDetourBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-foreground">
        우회 허용 시간(분)
      </h3>
      <div
        role="radiogroup"
        aria-label="최대 우회 시간(분)"
        className="flex overflow-hidden rounded-xl border border-border"
      >
        {MAX_DETOUR_STEPS.map((step, i) => {
          const active = value >= CEIL ? step === CEIL : step === value;
          return (
            <button
              key={step}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(step)}
              className={cn(
                "flex-1 py-2 text-center text-sm tabular-nums transition-colors",
                i > 0 && "border-l border-border",
                active
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {step}
            </button>
          );
        })}
      </div>
    </section>
  );
}
