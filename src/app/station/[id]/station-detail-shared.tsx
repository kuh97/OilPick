"use client";

import Link from "next/link";
import Image from "next/image";
import {
  AlertTriangle,
  Droplets,
  PhoneCall,
  SearchAlert,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TierBadge } from "@/components/result/tier-badge";
import { HelpDrawer } from "@/components/help-drawer";
import { brandName, type Tier } from "@/domain/types";
import type { NaviApp } from "@/domain/deeplink";
import type { Fuel, WireStationSummary } from "@/app/api/_lib/types";
import type { FeedbackSource } from "@/lib/api/useFeedback";

const FUEL_LABEL: Record<Fuel, string> = {
  GASOLINE: "휘발유",
  DIESEL: "경유",
  LPG: "LPG",
};

function formatPriceDate(iso: string | null): string {
  if (!iso) return "기준일자 정보 없음";
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} 기준`;
}

export const NAVI_APPS: { app: NaviApp; label: string; appName?: string }[] = [
  { app: "KAKAO", label: "카카오맵으로 길찾기" },
  {
    app: "NAVER",
    label: "네이버지도로 길찾기",
    appName: "https://oilpick.vercel.app",
  },
  { app: "TMAP", label: "TMAP으로 길찾기" },
];

const NAVI_ICONS: Record<NaviApp, string> = {
  KAKAO: "/brand/navigation/kakaomap.png",
  NAVER: "/brand/navigation/navermap.png",
  TMAP: "/brand/navigation/tmap.png",
};

export function StationDetailHeader({
  backHref,
  backLabel,
  stationName,
  feedbackSource,
  stationId,
  searchId,
  originName,
  destinationName,
}: {
  backHref: string;
  backLabel: string;
  stationName: string;
  feedbackSource?: FeedbackSource;
  stationId?: string;
  searchId?: string;
  originName?: string;
  destinationName?: string;
}) {
  return (
    <header>
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm text-muted-foreground">
          ← {backLabel}
        </Link>
        <HelpDrawer
          stationId={stationId}
          stationName={stationName}
          feedbackSource={feedbackSource}
          searchId={searchId}
          originName={originName}
          destinationName={destinationName}
        />
      </div>
    </header>
  );
}

export function StationDetailTitle({
  stationName,
  tier,
}: {
  stationName: string;
  tier?: Tier;
}) {
  return (
    <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
      <span>{stationName}</span>
      {tier && <TierBadge tier={tier} />}
    </h1>
  );
}

export function StationPriceCard({
  fuel,
  price,
  priceUpdatedAt,
  refuelAmountL,
  estimatedTotalWon,
}: {
  fuel: Fuel;
  price: number | null;
  priceUpdatedAt: string | null;
  refuelAmountL: number;
  estimatedTotalWon?: number | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-sm)] md:p-4">
      <h2 className="sr-only">가격</h2>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-2xl font-bold tracking-tight md:tabular-nums">
          {price != null ? `${price.toLocaleString()}원/L` : "가격 정보 없음"}
        </p>
        <p className="text-xs text-muted-foreground">
          {FUEL_LABEL[fuel]} · {formatPriceDate(priceUpdatedAt)}
        </p>
      </div>
      {estimatedTotalWon != null && (
        <p className="mt-1 text-sm text-muted-foreground md:tabular-nums">
          {refuelAmountL}L 주유 시 예상 {estimatedTotalWon.toLocaleString()}원
        </p>
      )}
      <Alert variant="warning" className="mt-3">
        <AlertTriangle aria-hidden />
        <AlertDescription className="break-keep text-xs text-warning-foreground">
          가격은 실제와 다를 수 있습니다.
        </AlertDescription>
      </Alert>
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
  const facilityItems = [
    { enabled: facilities.carWash, icon: Droplets, label: "세차" },
    { enabled: facilities.maintenance, icon: Wrench, label: "경정비" },
    { enabled: facilities.cvs, icon: Store, label: "편의점" },
  ].filter((facility) => facility.enabled);

  return (
    <section className="rounded-xl border border-border bg-card p-3.5 text-sm shadow-[var(--shadow-sm)] md:p-4">
      <dl className="space-y-2">
        <div className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <dt className="text-muted-foreground">브랜드</dt>
          <dd className="min-w-0 text-right">{brandName(brand)}</dd>
        </div>
        <div className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <dt className="text-muted-foreground">시설</dt>
          <dd className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {facilityItems.length > 0 ? (
              facilityItems.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 text-xs text-muted-foreground"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">정보 없음</span>
            )}
          </dd>
        </div>
        <div className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <dt className="text-muted-foreground">주소</dt>
          <dd className="min-w-0 break-keep text-right text-muted-foreground">
            {address}
          </dd>
        </div>
        <div className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <dt className="text-muted-foreground">전화</dt>
          <dd className="min-w-0 text-right">
            {tel ? (
              <a
                href={`tel:${tel}`}
                className="inline-flex items-center justify-end gap-1 text-primary underline"
              >
                <PhoneCall className="size-3.5" aria-hidden />
                {tel}
              </a>
            ) : (
              <span className="text-muted-foreground">정보 없음</span>
            )}
          </dd>
        </div>
      </dl>
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
          className="gap-2"
          onClick={() => onClick(app, appName)}
        >
          <Image
            src={NAVI_ICONS[app]}
            alt=""
            width={20}
            height={20}
            className="size-5 shrink-0"
          />
          <span>{label}</span>
        </Button>
      ))}
      <MobileNaviNotes isMobile={isMobile} />
    </div>
  );
}

function MobileNaviNotes({ isMobile }: { isMobile: boolean | null }) {
  if (!isMobile) return null;

  return (
    <p className="flex items-start justify-center gap-1.5 break-keep text-center text-xs text-muted-foreground">
      <SearchAlert className="size-3.5 shrink-0" aria-hidden />
      <span>TMAP 이용 시 경로는 주유소까지만 안내됩니다.</span>
    </p>
  );
}
