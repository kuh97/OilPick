"use client";

import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import {
  Copy,
  Droplets,
  Info,
  PhoneCall,
  SearchAlert,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <header className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={backHref}
          className="min-w-0 truncate text-sm text-text-body transition-colors hover:text-route-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-route-blue/50"
        >
          <span aria-hidden>← </span>
          {backLabel}
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
    <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-text-strong md:text-2xl">
      <span>{stationName}</span>
      {tier && <TierBadge tier={tier} />}
    </h1>
  );
}

function CopyAddressButton({ address }: { address: string }) {
  async function handleCopy() {
    if (!navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(address);
      toast("복사되었습니다.", { duration: 1600 });
    } catch {
      // 브라우저가 클립보드 권한을 거부하면 조용히 종료한다.
    }
  }

  return (
    <button
      type="button"
      aria-label="주소 복사"
      title="주소 복사"
      onClick={() => void handleCopy()}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control-sm border border-border bg-surface px-2 text-xs font-medium text-text-body transition-colors hover:border-route-strong hover:bg-route-sky hover:text-route-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-route-blue/50"
    >
      <Copy className="size-3.5" aria-hidden />
      <span>복사</span>
    </button>
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
    <section className="rounded-card border border-route-strong/15 bg-surface p-4 shadow-route-sm md:p-5">
      <h2 className="sr-only">가격</h2>
      <p className="text-xs font-semibold text-text-body">{FUEL_LABEL[fuel]}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-route text-2xl font-bold tracking-tight text-text-strong md:tabular-nums">
          {price != null ? `${price.toLocaleString()}원/L` : "가격 정보 없음"}
        </p>
        <p className="text-xs font-medium text-text-body md:tabular-nums">
          {formatPriceDate(priceUpdatedAt)}
        </p>
      </div>
      {estimatedTotalWon != null && (
        <p className="mt-2 text-sm text-text-body md:tabular-nums">
          {refuelAmountL}L 주유 시 예상 {estimatedTotalWon.toLocaleString()}원
        </p>
      )}
      <div className="mt-4 border-t border-route-strong/15 pt-3">
        <p className="flex items-center gap-2 break-keep text-xs leading-5 text-warning-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span>가격은 실제와 다를 수 있습니다.</span>
        </p>
      </div>
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
    <section className="rounded-card border border-route-strong/15 bg-surface p-4 text-sm shadow-route-sm md:p-5">
      <dl className="divide-y divide-border/70">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-2 first:pt-0">
          <dt className="font-medium text-text-body">브랜드</dt>
          <dd className="min-w-0 text-right font-medium">{brandName(brand)}</dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-2">
          <dt className="font-medium text-text-body">시설</dt>
          <dd className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {facilityItems.length > 0 ? (
              facilityItems.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex h-7 items-center gap-1 rounded-control-sm border border-route-strong/15 bg-surface-quiet px-2 text-xs font-medium text-text-body"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </span>
              ))
            ) : (
              <span className="text-text-body">정보 없음</span>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-2">
          <dt className="font-medium text-text-body">주소</dt>
          <dd className="flex min-w-0 items-center justify-end gap-2">
            <span className="min-w-0 break-keep text-right font-medium text-text-body">
              {address}
            </span>
            <CopyAddressButton address={address} />
          </dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-2 last:pb-0">
          <dt className="font-medium text-text-body">전화</dt>
          <dd className="min-w-0 text-right">
            {tel ? (
              <a
                href={`tel:${tel}`}
                className="inline-flex items-center justify-end gap-1 font-semibold text-route-strong underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-route-blue/50"
              >
                <PhoneCall className="size-3.5" aria-hidden />
                {tel}
              </a>
            ) : (
              <span className="text-text-body">정보 없음</span>
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
          className="h-12 gap-2 border-route-strong/25 bg-surface text-text-strong hover:border-route-strong hover:bg-route-sky hover:text-text-strong"
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
    <p className="flex items-start justify-center gap-1.5 break-keep text-center text-xs leading-5 text-text-body">
      <SearchAlert className="size-3.5 shrink-0" aria-hidden />
      <span>TMAP 이용 시 경로는 주유소까지만 안내됩니다.</span>
    </p>
  );
}
