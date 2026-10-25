"use client";

/**
 * 결과 카드 — PRODUCT.md §5.3 ④.
 * 가격 기준일자 표시는 AGENTS.md §6 UI 불변식(제거 금지) — 유가 CSV가 하루 1회
 * 스냅샷이라는 걸 사용자가 알 수 있어야 한다. "오래된 정보" 경고 문구는 넣지 않는다
 * (제품 결정 — 날짜 자체가 정보이므로 별도 낙인 문구 없이 사실만 보여준다).
 */
import Link from "next/link";
import { ChevronRight, Droplets, PiggyBank, Store, Wrench } from "lucide-react";
import { TierBadge } from "./tier-badge";
import { distanceMToKm, durationSToMin } from "@/domain/pricing";
import type { WireCandidate } from "@/app/api/_lib/types";

const FACILITY_ICON: { key: keyof WireCandidate["facilities"]; Icon: typeof Droplets; label: string }[] = [
  { key: "carWash", Icon: Droplets, label: "세차" },
  { key: "maintenance", Icon: Wrench, label: "경정비" },
  { key: "cvs", Icon: Store, label: "편의점" },
];

function formatPriceTime(iso: string | null): string {
  if (!iso) return "기준일자 정보 없음";
  const date = new Date(iso);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} 기준`;
}

export function ResultCard({
  rank,
  candidate,
  referencePrice,
}: {
  rank: number;
  candidate: WireCandidate;
  referencePrice: number | null;
}) {
  const priceTimeText = formatPriceTime(candidate.priceUpdatedAt);
  const activeFacilities = FACILITY_ICON.filter((f) => candidate.facilities[f.key]);
  // 카드에는 순이득(우회 손해까지 반영한 원화 총액) 대신, 평균가 대비 리터당 가격차만
  // 간단히 보여준다 — 정렬·T3 게이트 등 나머지 로직은 여전히 netSaving 기준.
  const perLiterDiff = referencePrice != null ? referencePrice - candidate.price : null;

  return (
    <Link
      href={`/station/${candidate.id}`}
      className="block rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)] transition-all hover:shadow-[var(--shadow-md)] active:scale-[0.98]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">{rank}</span>
          <TierBadge tier={candidate.tier} />
          <span className="text-sm font-medium">{candidate.name}</span>
        </div>
      </div>

      <p className="mt-1.5 text-xl font-bold tracking-tight">{candidate.price.toLocaleString()}원/L</p>

      <p className="mt-1 text-sm text-muted-foreground">
        {candidate.detour.precise ? (
          <>
            +{distanceMToKm(candidate.detour.distanceM)}km · +{durationSToMin(candidate.detour.durationS)}분 우회
          </>
        ) : (
          <>경로에서 약 {distanceMToKm(candidate.perpDistanceM)}km 떨어져 있어요.</>
        )}
      </p>

      {perLiterDiff != null && (
        <p className="mt-1 flex items-center gap-1 text-sm">
          {perLiterDiff > 0 ? (
            <span className="flex items-center gap-1 font-medium text-success-foreground">
              <PiggyBank className="size-3.5" aria-hidden />
              평균보다 리터당 {perLiterDiff.toLocaleString()}원 저렴
            </span>
          ) : perLiterDiff === 0 ? (
            <span className="text-muted-foreground">평균가</span>
          ) : (
            <span className="text-muted-foreground">평균보다 리터당 {Math.abs(perLiterDiff).toLocaleString()}원 비쌈</span>
          )}
        </p>
      )}

      {activeFacilities.length > 0 && (
        <p className="mt-1.5 flex gap-3 text-sm text-muted-foreground">
          {activeFacilities.map(({ key, Icon, label }) => (
            <span key={key} className="flex items-center gap-1">
              <Icon className="size-3.5" aria-hidden />
              {label}
            </span>
          ))}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">{priceTimeText}</span>
        <span className="flex items-center gap-0.5 text-sm font-medium text-primary">
          상세
          <ChevronRight className="size-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
