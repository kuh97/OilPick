"use client";

/**
 * "허용 우회 거리" 세그먼트 바 — 결과 필터 시트에서 사용한다.
 */
import { cn } from "@/lib/utils";

export const DETOUR_DISTANCE_STEPS_KM = [3, 5, 10, 15] as const;

export function DetourDistanceBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (distanceKm: number) => void;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5">
      <h3 className="text-sm font-medium text-foreground">
        허용 우회 거리(km)
      </h3>
      <div
        role="radiogroup"
        aria-label="허용 우회 거리(km)"
        className="flex overflow-hidden rounded-xl border border-border"
      >
        {DETOUR_DISTANCE_STEPS_KM.map((step, i) => {
          const active = step === value;
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
                  ? "bg-route-blue font-semibold text-white"
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
