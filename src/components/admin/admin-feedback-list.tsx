"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAdminFeedback,
  type AdminFeedbackItem,
  type AdminFeedbackStatus,
  type AdminFeedbackStatusFilter,
} from "@/lib/api/useAdminFeedback";
import { useAdminFeedbackCounts } from "@/lib/api/useAdminFeedbackCounts";
import { useAdminFeedbackStatus } from "@/lib/api/useAdminFeedbackStatus";

const STATUS_OPTIONS: Array<{ value: AdminFeedbackStatusFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "NEW", label: "새 문의" },
  { value: "IN_PROGRESS", label: "확인 중" },
  { value: "RESOLVED", label: "처리 완료" },
];

const STATUS_CHANGE_OPTIONS: Array<{ value: AdminFeedbackStatus; label: string }> = [
  { value: "NEW", label: "새 문의" },
  { value: "IN_PROGRESS", label: "확인 중" },
  { value: "RESOLVED", label: "처리 완료" },
];

const STATUS_LABEL: Record<AdminFeedbackStatus, string> = {
  NEW: "새 문의",
  IN_PROGRESS: "확인 중",
  RESOLVED: "처리 완료",
};

const STATUS_CLASS_NAME: Record<AdminFeedbackStatus, string> = {
  NEW: "bg-info text-info-foreground",
  IN_PROGRESS: "bg-warning text-warning-foreground",
  RESOLVED: "bg-success text-success-foreground",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function FeedbackCard({
  feedback,
  isUpdating,
  onStatusChange,
}: {
  feedback: AdminFeedbackItem;
  isUpdating: boolean;
  onStatusChange: (status: AdminFeedbackStatus) => void;
}) {
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStatusMenuOpen) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !statusMenuRef.current?.contains(event.target)) {
        setIsStatusMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsStatusMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isStatusMenuOpen]);

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold">{feedback.subject}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {feedback.email} · {formatDate(feedback.createdAt)}
          </p>
        </div>
        <div ref={statusMenuRef} className="relative">
          <button
            type="button"
            aria-label={`${feedback.subject} 상태 변경`}
            aria-haspopup="menu"
            aria-expanded={isStatusMenuOpen}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${STATUS_CLASS_NAME[feedback.status]}`}
            disabled={isUpdating}
            onClick={() => setIsStatusMenuOpen((open) => !open)}
          >
            {STATUS_LABEL[feedback.status]}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          {isStatusMenuOpen ? (
            <div
              role="menu"
              aria-label="문의 상태"
              className="absolute right-0 z-20 mt-2 min-w-32 rounded-xl border border-border bg-card p-1"
            >
              {STATUS_CHANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={feedback.status === option.value}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    feedback.status === option.value ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                  onClick={() => {
                    setIsStatusMenuOpen(false);
                    if (feedback.status !== option.value) onStatusChange(option.value);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {isUpdating ? (
            <span className="sr-only" aria-live="polite">
              저장 중...
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-foreground">{feedback.content}</p>
      {feedback.stationId || feedback.searchId ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {feedback.stationId ? `주유소: ${feedback.stationId}` : null}
          {feedback.stationId && feedback.searchId ? " · " : null}
          {feedback.searchId ? `검색: ${feedback.searchId}` : null}
        </p>
      ) : null}
    </article>
  );
}

export function AdminFeedbackList() {
  const [status, setStatus] = useState<AdminFeedbackStatusFilter>("ALL");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { items, isLoading, error, hasNextPage, loadMore, retry } = useAdminFeedback(status);
  const { counts } = useAdminFeedbackCounts();
  const statusMutation = useAdminFeedbackStatus();

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  return (
    <section className="mt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">서비스 문의</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            새 문의부터 오래된 문의 순서로 확인할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label="문의 상태 필터">
        {STATUS_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={status === option.value ? "default" : "outline"}
            aria-pressed={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label} {counts ? counts[option.value] : "-"}
          </Button>
        ))}
      </div>

      {error && items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button className="mt-4" type="button" size="sm" variant="outline" onClick={retry}>
            다시 불러오기
          </Button>
        </div>
      ) : null}

      {statusMutation.error ? (
        <div className="mt-4 rounded-xl bg-destructive/5 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{statusMutation.error}</p>
        </div>
      ) : null}

      {!isLoading && !error && items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          아직 문의가 없습니다.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {items.map((feedback) => (
          <FeedbackCard
            key={feedback.id}
            feedback={feedback}
            isUpdating={statusMutation.isUpdating && statusMutation.updatingId === feedback.id}
            onStatusChange={(nextStatus) => {
              if (nextStatus !== feedback.status) {
                statusMutation.updateStatus({ id: feedback.id, status: nextStatus });
              }
            }}
          />
        ))}
      </div>

      {error && items.length > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-destructive/5 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            재시도
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground" aria-live="polite">
          문의를 불러오는 중...
        </p>
      ) : null}
      {!isLoading && hasNextPage ? <div ref={sentinelRef} className="h-2" aria-hidden="true" /> : null}
      {!isLoading && !hasNextPage && items.length > 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">모든 문의를 확인했습니다.</p>
      ) : null}
    </section>
  );
}
