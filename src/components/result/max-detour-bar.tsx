"use client";

/**
 * "우회 허용 시간" 세그먼트 바 (5분 단위) — §5.3 ⑥. 필터 시트 안에서 씀 (불변식 8).
 * `ceilingMinutes`는 `pricing.maxDetourCeilingMinutes` 값 — 30 하드코딩 금지.
 */
import { cn } from "@/lib/utils";

export function maxDetourSteps(ceilingMinutes: number): number[] {
  const steps: number[] = [];
  for (let m = 5; m <= ceilingMinutes; m += 5) steps.push(m);
  return steps.length > 0 ? steps : [5];
}

export function MaxDetourBar({
  value,
  ceilingMinutes,
  onChange,
}: {
  value: number;
  ceilingMinutes: number;
  onChange: (minutes: number) => void;
}) {
  const steps = maxDetourSteps(ceilingMinutes);
  const ceil = steps[steps.length - 1];
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
        {steps.map((step, i) => {
          const active = value >= ceil ? step === ceil : step === value;
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
