"use client";

/** 연료 3택 — PRODUCT.md §5.1 (필수, 기본값은 마지막 선택값) */

import { cn } from "@/lib/utils";
import type { Fuel } from "@/app/api/_lib/types";

const FUEL_LABEL: Record<Fuel, string> = {
  GASOLINE: "휘발유",
  DIESEL: "경유",
  LPG: "LPG",
};

const FUELS: Fuel[] = ["GASOLINE", "DIESEL", "LPG"];

export function FuelSelect({ value, onChange }: { value: Fuel; onChange: (fuel: Fuel) => void }) {
  return (
    <div
      className="flex min-w-0 gap-1 rounded-control bg-surface-quiet p-1"
      role="radiogroup"
      aria-label="연료 종류"
    >
      {FUELS.map((fuel) => (
        <button
          key={fuel}
          type="button"
          role="radio"
          aria-checked={value === fuel}
          onClick={() => onChange(fuel)}
          className={cn(
            "min-h-10 flex-1 rounded-control-sm px-3 text-center text-sm font-medium whitespace-nowrap transition-colors",
            value === fuel
              ? "bg-surface text-text-strong shadow-route-sm"
              : "text-text-body hover:text-text-strong",
          )}
        >
          {FUEL_LABEL[fuel]}
        </button>
      ))}
    </div>
  );
}
