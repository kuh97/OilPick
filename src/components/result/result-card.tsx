"use client";

/**
 * 결과 카드 — PRODUCT.md §5.3 ④.
 * 가격 기준일자 표시는 AGENTS.md §6 UI 불변식(제거 금지) — 유가 CSV가 하루 1회
 * 스냅샷이라는 걸 사용자가 알 수 있어야 한다. "오래된 정보" 경고 문구는 넣지 않는다
 * (제품 결정 — 날짜 자체가 정보이므로 별도 낙인 문구 없이 사실만 보여준다).
 */
import Link from "next/link";
import { ChevronRight, Droplets, Info, PiggyBank, Store, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TierBadge } from "./tier-badge";
import type { WireCandidate, WireVehicle } from "@/app/api/_lib/types";

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

function formatSignedWon(amountWon: number): string {
  if (amountWon === 0) return "0원";
  const sign = amountWon > 0 ? "+" : "-";
  return `${sign}${Math.abs(amountWon).toLocaleString()}원`;
}

export function ResultCard({
  rank,
  candidate,
  referencePrice,
  vehicle,
}: {
  rank: number;
  candidate: WireCandidate;
  referencePrice: number | null;
  vehicle: WireVehicle;
}) {
  const priceTimeText = formatPriceTime(candidate.priceUpdatedAt);
  const activeFacilities = FACILITY_ICON.filter((f) => candidate.facilities[f.key]);
  // 우회 거리·시간은 검색 목록에 표시하지 않고, 이미 계산된 순절감액은 예상치로만
  // 보여준다. 후보 정렬·T3 게이트 등 계산 로직은 서버 결과와 기존 클라이언트 재정렬을 따른다.
  const perLiterDiff = referencePrice != null ? referencePrice - candidate.price : null;
  const priceSavingWon =
    referencePrice != null
      ? Math.round((referencePrice - candidate.price) * vehicle.refuelAmount)
      : null;
  const detourFuelCostWon = Math.round(
    (candidate.detour.distanceM / 1000 / vehicle.efficiency) * candidate.price,
  );
  const netSavingLabel =
    candidate.netSaving > 0
      ? `${candidate.netSaving.toLocaleString()}원 절약`
      : candidate.netSaving < 0
        ? `${Math.abs(candidate.netSaving).toLocaleString()}원 손해`
        : "절감 없음";
  const netSavingClassName =
    candidate.netSaving > 0 ? "text-success-foreground" : "text-text-body";
  const priceDiffClassName =
    perLiterDiff != null && perLiterDiff > 0
      ? "text-success-foreground"
      : perLiterDiff === 0
        ? "text-text-body"
        : "text-text-muted";

  return (
    <Dialog>
      <div className="group relative overflow-hidden rounded-card border border-route-strong/20 bg-surface shadow-route-sm transition-all hover:border-route-cyan hover:shadow-route-md">
        <Link
          href={`/station/${candidate.id}`}
          aria-label={`${candidate.name} 상세 보기`}
          className="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-route-strong/30"
        >
          <span className="sr-only">{candidate.name} 상세 보기</span>
        </Link>

        <div className="relative z-10 pointer-events-none p-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-route-sky font-route text-sm font-semibold text-route-strong">
              {rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <TierBadge tier={candidate.tier} />
                <span className="min-w-0 truncate text-base font-semibold text-text-strong">
                  {candidate.name}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-route text-2xl font-bold tracking-tight text-text-strong">
              {candidate.price.toLocaleString()}원/L
            </p>
            <div className={`flex items-center gap-1 font-route text-sm font-semibold ${netSavingClassName}`}>
              <span>{netSavingLabel}</span>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="pointer-events-auto text-text-body hover:bg-route-sky hover:text-route-strong"
                    aria-label="절약액 계산 방법"
                    title="절약액 계산 방법"
                  />
                }
              >
                <Info className="size-3.5" aria-hidden />
              </DialogTrigger>
            </div>
          </div>

          {perLiterDiff != null && (
            <p className={`mt-1 flex items-center gap-1 text-sm ${priceDiffClassName}`}>
              <PiggyBank className="size-3.5" aria-hidden />
              {perLiterDiff > 0 ? (
                <span className="font-medium">평균보다 리터당 {perLiterDiff.toLocaleString()}원 저렴</span>
              ) : perLiterDiff === 0 ? (
                <span>평균가</span>
              ) : (
                <span>평균보다 리터당 {Math.abs(perLiterDiff).toLocaleString()}원 비쌈</span>
              )}
            </p>
          )}

          {activeFacilities.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
              {activeFacilities.map(({ key, Icon, label }) => (
                <span key={key} className="flex items-center gap-1">
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </span>
              ))}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-route-strong/15 pt-2">
            <span className="text-xs text-text-body">{priceTimeText}</span>
            <span className="flex items-center gap-0.5 text-sm font-semibold text-route-strong">
              상세
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          </div>
        </div>
      </div>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>절약액 계산 방법</DialogTitle>
          <DialogDescription>
            기준가 대비 주유비에서 우회 연료비를 뺀 금액이에요.
          </DialogDescription>
        </DialogHeader>

        {priceSavingWon == null ? (
          <p className="text-sm text-text-body">
            기준가를 계산할 수 없어 절약액을 산출하지 않았어요.
          </p>
        ) : (
          <>
            <div className="space-y-2 rounded-control bg-route-sky/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-body">기준가 대비 주유비</span>
                <span className="font-route font-semibold text-text-strong">
                  {formatSignedWon(priceSavingWon)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-body">우회 연료비</span>
                <span className="font-route font-semibold text-text-strong">
                  {detourFuelCostWon > 0
                    ? `-${detourFuelCostWon.toLocaleString()}원`
                    : "0원"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-route-strong/15 pt-2">
                <span className="font-semibold text-text-strong">최종 금액</span>
                <span className={`font-route font-bold ${netSavingClassName}`}>
                  {netSavingLabel}
                </span>
              </div>
            </div>
            <p className="text-xs leading-5 text-text-body">
              <span className="block">
                예상 우회거리 기준으로 계산하며, 시간·통행료는 포함하지 않아요.
              </span>
              <span className="mt-1 block">상세에서 실제 경로 기준으로 다시 계산해요.</span>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
