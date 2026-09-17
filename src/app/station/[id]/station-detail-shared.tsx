"use client";

import Link from "next/link";
import {
  Droplets,
  PhoneCall,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TierBadge } from "@/components/result/tier-badge";
import { brandName, type Tier } from "@/domain/types";
import type { NaviApp } from "@/domain/deeplink";
import type { WireStationSummary } from "@/app/api/_lib/types";

export const NAVI_APPS: { app: NaviApp; label: string; appName?: string }[] = [
  { app: "KAKAO", label: "카카오맵" },
  { app: "NAVER", label: "네이버지도", appName: "https://oilpick.vercel.app" },
  { app: "TMAP", label: "티맵" },
];

export function StationDetailHeader({
  backHref,
  backLabel,
  stationName,
  tier,
}: {
  backHref: string;
  backLabel: string;
  stationName: string;
  tier?: Tier;
}) {
  return (
    <header>
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm text-muted-foreground">
          ← {backLabel}
        </Link>
        {tier && <TierBadge tier={tier} />}
      </div>
      <h1 className="mt-3 text-xl font-bold">{stationName}</h1>
    </header>
  );
}

export function StationPriceCard({
  price,
  refuelAmountL,
  estimatedTotalWon,
}: {
  price: number | null;
  refuelAmountL: number;
  estimatedTotalWon?: number | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)]">
      <h2 className="mb-1 text-sm font-semibold">가격</h2>
      <p className="text-2xl font-bold tracking-tight">
        {price != null ? `${price.toLocaleString()}원/L` : "가격 정보 없음"}
      </p>
      {estimatedTotalWon != null && (
        <p className="mt-1 text-sm text-muted-foreground">
          {refuelAmountL}L 주유 시 예상 {estimatedTotalWon.toLocaleString()}원
        </p>
      )}
    </section>
  );
}

export function StationInfoCard({
  brand,
  facilities,
  address,
  tel,
}: {
  brand: string;
  facilities: WireStationSummary["facilities"];
  address: string;
  tel: string | null;
}) {
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 text-sm shadow-[var(--shadow-sm)]">
      <div className="flex gap-3 text-muted-foreground">
        {facilities.carWash && (
          <span className="flex items-center gap-1">
            <Droplets className="size-3.5" aria-hidden />
            세차
          </span>
        )}
        {facilities.maintenance && (
          <span className="flex items-center gap-1">
            <Wrench className="size-3.5" aria-hidden />
            경정비
          </span>
        )}
        {facilities.cvs && (
          <span className="flex items-center gap-1">
            <Store className="size-3.5" aria-hidden />
            편의점
          </span>
        )}
      </div>
      <p className="text-muted-foreground">{brandName(brand)}</p>
      <p className="text-muted-foreground">{address}</p>
      {tel && (
        <a
          href={`tel:${tel}`}
          className="flex items-center gap-1 text-primary underline"
        >
          <PhoneCall className="size-3.5" aria-hidden />
          {tel}
        </a>
      )}
    </section>
  );
}

export function StationNaviButtons({
  isMobile,
  onClick,
}: {
  isMobile: boolean | null;
  onClick: (app: NaviApp, appName?: string) => void;
}) {
  const visibleNaviApps = NAVI_APPS.filter(
    ({ app }) => app !== "TMAP" || isMobile,
  );

  return (
    <div className="flex flex-col gap-2">
      {visibleNaviApps.map(({ app, label, appName }) => (
        <Button
          key={app}
          variant="outline"
          size="lg"
          onClick={() => onClick(app, appName)}
        >
          {label}
        </Button>
      ))}
      <MobileNaviNotes isMobile={isMobile} />
    </div>
  );
}

function MobileNaviNotes({ isMobile }: { isMobile: boolean | null }) {
  if (!isMobile) return null;

  return (
    <div className="break-keep flex flex-col gap-1 text-xs text-muted-foreground">
      <p>지도 앱은 설치되어 있어야 열 수 있습니다.</p>
      <p>
        티맵은 주유소까지만 안내됩니다. 주유 후 최종 목적지를 다시
        입력해주세요.
      </p>
    </div>
  );
}
