/** 배지 2종 — 경로상 / 우회 (§6.4). */
import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import type { Tier } from "@/app/api/_lib/types";

const TIER_META: Record<Tier, { variant: VariantProps<typeof badgeVariants>["variant"]; label: string }> = {
  ON_ROUTE: { variant: "success", label: "경로상" },
  DETOUR: { variant: "warning", label: "우회" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const { variant, label } = TIER_META[tier];
  return <Badge variant={variant}>{label}</Badge>;
}
