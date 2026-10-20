"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAdminDashboard, type AdminDashboardData, type AdminDashboardRange } from "@/lib/api/useAdminDashboard";
import { useAdminFeedbackCounts } from "@/lib/api/useAdminFeedbackCounts";

const RANGE_OPTIONS: Array<{ value: AdminDashboardRange; label: string }> = [
  { value: "24h", label: "24시간" },
  { value: "7d", label: "7일" },
  { value: "30d", label: "30일" },
];

const IMPORT_STATUS_LABEL: Record<string, string> = {
  OK: "정상",
  GATE_FAILED: "검증 실패",
  DOWNLOAD_FAILED: "다운로드 실패",
};

const IMPORT_STATUS_CLASS: Record<string, string> = {
  OK: "bg-success text-success-foreground",
  GATE_FAILED: "bg-warning text-warning-foreground",
  DOWNLOAD_FAILED: "bg-destructive/10 text-destructive",
};

const APP_LABEL: Record<keyof AdminDashboardData["navi"]["byApp"], string> = {
  KAKAO: "카카오맵",
  NAVER: "네이버지도",
  TMAP: "티맵",
};

const TIER_LABEL: Record<keyof AdminDashboardData["navi"]["byTier"], string> = {
  ON_ROUTE: "경로상",
  DETOUR: "우회",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatAverage(value: number | null): string {
  return value == null ? "—" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatRate(value: number, hasData: boolean): string {
  if (!hasData) return "—";
  return new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(value: number | null): string {
  if (value == null) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(1)}초`;
}

function formatRangeLabel(range: AdminDashboardRange): string {
  if (range === "24h") return "최근 24시간";
  if (range === "7d") return "최근 7일";
  return "최근 30일";
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">{value}</dd>
      {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
    </article>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0 last:pb-0 first:pt-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function BreakdownList<T extends string>({
  values,
  labels,
}: {
  values: Record<T, number>;
  labels: Record<T, string>;
}) {
  const entries = Object.entries(values) as Array<[T, number]>;
  const max = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <dl className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{labels[key]}</dt>
            <dd className="font-semibold text-foreground">{formatNumber(value)}</dd>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </dl>
  );
}

function DashboardContent({
  dashboard,
  newFeedbackCount,
}: {
  dashboard: AdminDashboardData;
  newFeedbackCount: number | null;
}) {
  const { priceData, search, navi } = dashboard;
  const latestImport = priceData.latestImport;
  const backfillPercent = priceData.detailBackfill.total > 0
    ? Math.round((priceData.detailBackfill.done / priceData.detailBackfill.total) * 100)
    : null;

  return (
    <>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="새 문의" value={newFeedbackCount == null ? "—" : formatNumber(newFeedbackCount)} detail="현재 새 문의 상태" />
        <MetricCard label="가격 기준일" value={latestImport?.pricedOn ?? "—"} detail={latestImport?.status === "OK" ? "최근 임포트 정상" : "최근 임포트 상태 확인 필요"} />
        <MetricCard label="완료된 검색" value={formatNumber(search.completedCount)} detail={formatRangeLabel(dashboard.range)} />
        <MetricCard label="결과 0건" value={formatRate(search.zeroResultRate, search.completedCount > 0)} />
        <MetricCard label="T3 우회 추천" value={formatRate(search.t3Rate, search.completedCount > 0)} />
        <MetricCard label="내비 버튼 클릭률" value={formatRate(navi.clickRate, search.completedCount > 0)} detail="실제 앱 실행 성공률 아님" />
      </dl>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="price-status-title">
          <h3 id="price-status-title" className="text-lg font-bold">가격 데이터</h3>
          <dl className="mt-5">
            <DataRow label="기준일" value={latestImport?.pricedOn ?? "—"} />
            <DataRow
              label="최근 상태"
              value={latestImport ? IMPORT_STATUS_LABEL[latestImport.status] ?? latestImport.status : "—"}
            />
            <DataRow label="마지막 임포트" value={formatDate(latestImport?.startedAt ?? null)} />
            <DataRow label="휘발유 행 수" value={latestImport?.oilRows == null ? "—" : formatNumber(latestImport.oilRows)} />
            <DataRow label="LPG 행 수" value={latestImport?.lpgRows == null ? "—" : formatNumber(latestImport.lpgRows)} />
          </dl>
          {latestImport ? (
            <span className={`mt-5 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${IMPORT_STATUS_CLASS[latestImport.status] ?? "bg-muted text-muted-foreground"}`}>
              {IMPORT_STATUS_LABEL[latestImport.status] ?? latestImport.status}
            </span>
          ) : null}
          {latestImport?.failedGate || latestImport?.detail ? (
            <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              {latestImport.failedGate ? `${latestImport.failedGate}: ` : null}{latestImport.detail ?? "상세 내용 없음"}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="backfill-status-title">
          <h3 id="backfill-status-title" className="text-lg font-bold">시설 정보 백필</h3>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-extrabold tracking-tight">{backfillPercent == null ? "—" : `${backfillPercent}%`}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatNumber(priceData.detailBackfill.done)}건 완료 · {formatNumber(priceData.detailBackfill.remaining)}건 남음
              </p>
            </div>
            <p className="text-right text-sm font-semibold text-foreground">전체 {formatNumber(priceData.detailBackfill.total)}건</p>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="시설 정보 백필 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={backfillPercent ?? 0}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${backfillPercent ?? 0}%` }} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">시설 정보는 백필 크론이 채우며, 이 화면에서는 데이터를 직접 수정하지 않습니다.</p>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="search-quality-title">
        <div>
          <h3 id="search-quality-title" className="text-lg font-bold">검색 품질</h3>
          <p className="mt-1 text-sm text-muted-foreground">검색 실행 수는 고유 사용자 수가 아닙니다.</p>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="평균 검색 처리 시간" value={formatDuration(search.averageDurationMs)} />
          <MetricCard label="warning 발생률" value={formatRate(search.warningRate, search.completedCount > 0)} />
          <MetricCard label="JSON 폴백 비율" value={formatRate(search.jsonFallbackRate, search.completedCount > 0)} />
          <MetricCard label="평균 표시 후보 수" value={formatAverage(search.averageDisplayedCandidates)} />
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="navi-title">
        <div>
          <h3 id="navi-title" className="text-lg font-bold">내비게이션 사용</h3>
          <p className="mt-1 text-sm text-muted-foreground">집계 기준은 외부 앱 실행 성공이 아닌 내비 버튼 클릭입니다.</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <MetricCard label="내비 클릭 수" value={formatNumber(navi.clickCount)} />
            <MetricCard label="내비 클릭률" value={formatRate(navi.clickRate, search.completedCount > 0)} />
            <MetricCard label="클릭 후보 평균 순위" value={formatAverage(navi.averageRank)} />
          </div>
          <article className="rounded-2xl border border-border bg-card p-5">
            <h4 className="font-bold">앱별 클릭</h4>
            <div className="mt-5"><BreakdownList values={navi.byApp} labels={APP_LABEL} /></div>
          </article>
          <article className="rounded-2xl border border-border bg-card p-5">
            <h4 className="font-bold">후보 유형별 클릭</h4>
            <div className="mt-5"><BreakdownList values={navi.byTier} labels={TIER_LABEL} /></div>
          </article>
        </div>
      </section>
    </>
  );
}

export function AdminDashboard() {
  const [range, setRange] = useState<AdminDashboardRange>("24h");
  const { dashboard, isLoading, isFetching, error, retry } = useAdminDashboard(range);
  const { counts } = useAdminFeedbackCounts();

  return (
    <section className="mt-10" aria-labelledby="admin-dashboard-title" aria-busy={isLoading}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="admin-dashboard-title" className="text-xl font-bold">운영 대시보드</h2>
          <p className="mt-1 text-sm text-muted-foreground">가격 데이터와 검색 품질을 한눈에 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="지표 기간 선택">
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={range === option.value ? "default" : "outline"}
              aria-pressed={range === option.value}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Button type="button" size="icon-sm" variant="ghost" aria-label="운영 지표 새로고침" onClick={retry} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} aria-hidden />
          </Button>
        </div>
      </div>

      <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        익명 검색 실행과 운영 데이터를 기반으로 한 내부 점검 화면입니다. 검색 실행 수는 고유 사용자 수가 아닙니다.
      </p>

      {error ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-destructive/5 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>다시 불러오기</Button>
        </div>
      ) : null}

      {isLoading && !dashboard ? (
        <p className="py-12 text-center text-sm text-muted-foreground" aria-live="polite">운영 지표를 불러오는 중...</p>
      ) : null}
      {dashboard ? <DashboardContent dashboard={dashboard} newFeedbackCount={counts?.NEW ?? null} /> : null}
    </section>
  );
}
