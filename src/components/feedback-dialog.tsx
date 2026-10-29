"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFeedback, type FeedbackSource } from "@/lib/api/useFeedback";

const EMPTY_FORM = { email: "", subject: "", content: "" };
const FEEDBACK_SOURCE_LABEL: Record<FeedbackSource, string> = {
  HOME: "홈",
  NEARBY: "내 위치",
  NEARBY_DETAIL: "내 위치 > 카드 상세",
  SEARCH: "검색",
  SEARCH_DETAIL: "검색 > 카드 상세",
};

export function FeedbackDialog({
  buttonLabel = "서비스 문의",
  feedbackSource,
  stationId,
  stationName,
  searchId,
  originName,
  destinationName,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
}: {
  buttonLabel?: string;
  feedbackSource?: FeedbackSource;
  stationId?: string;
  stationName?: string;
  searchId?: string;
  originName?: string;
  destinationName?: string;
  showTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { submitFeedback } = useFeedback();
  const open = controlledOpen ?? internalOpen;
  const routeLabel = originName || destinationName
    ? `${originName ?? "출발지"} → ${destinationName ?? "목적지"}`
    : null;

  function setOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      email: form.email.trim(),
      subject: form.subject.trim(),
      content: form.content.trim(),
      ...(feedbackSource ? { feedbackSource } : {}),
      ...(stationId ? { stationId } : {}),
      ...(stationName ? { stationName } : {}),
      ...(searchId ? { searchId } : {}),
      ...(originName ? { originName } : {}),
      ...(destinationName ? { destinationName } : {}),
    };

    if (!payload.email || !payload.subject || !payload.content) {
      setError("이메일, 제목, 내용을 모두 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitFeedback(payload);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setForm(EMPTY_FORM);
      setError(null);
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setForm(EMPTY_FORM);
      setError(null);
      setSubmitted(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger && (
        <DialogTrigger render={<Button variant="outline" className="w-full" />}>
          {buttonLabel}
        </DialogTrigger>
      )}
      <DialogContent className="rounded-card border border-route-strong/15 bg-surface p-5 text-text-strong shadow-route-md">
        {submitted ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-text-strong">문의가 접수됐어요</DialogTitle>
              <DialogDescription className="text-text-body">
                확인 후 입력한 이메일로 답변드릴게요.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="border-border bg-surface-quiet/70">
              <DialogClose
                render={
                  <Button className="bg-route-blue text-white hover:bg-route-strong" />
                }
              >
                닫기
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="text-text-strong">서비스 문의</DialogTitle>
              <DialogDescription className="text-text-body">
                불편한 점이나 잘못된 정보를 알려주세요.
              </DialogDescription>
            </DialogHeader>

            {feedbackSource || routeLabel || stationName ? (
              <div
                aria-label="문의에 포함되는 검색 정보"
                className="rounded-control-sm border border-route-strong/15 bg-surface-quiet/70 px-3 py-2 text-sm"
              >
                <p className="text-xs text-text-body">문의에 포함되는 정보</p>
                {feedbackSource ? (
                  <p className="mt-1 text-xs text-text-body">
                    문의 경로: {FEEDBACK_SOURCE_LABEL[feedbackSource]}
                  </p>
                ) : null}
                {routeLabel ? <p className="mt-1 font-medium">{routeLabel}</p> : null}
                {stationName ? (
                  <p className="mt-1 text-xs text-text-body">주유소: {stationName}</p>
                ) : null}
              </div>
            ) : null}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                이메일
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  className="rounded-control-sm border border-border bg-surface px-3 py-2.5 text-text-strong outline-none placeholder:text-text-muted focus:border-route-strong focus:ring-2 focus:ring-route-blue/30"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                제목
                <input
                  required
                  maxLength={120}
                  className="rounded-control-sm border border-border bg-surface px-3 py-2.5 text-text-strong outline-none placeholder:text-text-muted focus:border-route-strong focus:ring-2 focus:ring-route-blue/30"
                  value={form.subject}
                  onChange={(event) => updateField("subject", event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                내용
                <textarea
                  required
                  maxLength={4_000}
                  rows={5}
                  className="resize-y rounded-control-sm border border-border bg-surface px-3 py-2.5 text-text-strong outline-none placeholder:text-text-muted focus:border-route-strong focus:ring-2 focus:ring-route-blue/30"
                  value={form.content}
                  onChange={(event) => updateField("content", event.target.value)}
                />
              </label>
            </div>

            <DialogFooter className="border-border bg-surface-quiet/70">
              <DialogClose
                render={
                  <Button
                    variant="outline"
                    type="button"
                    className="border-route-strong/20 bg-surface text-text-strong hover:border-route-strong hover:bg-route-sky"
                  />
                }
              >
                취소
              </DialogClose>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-route-blue text-white hover:bg-route-strong"
              >
                {isSubmitting ? "보내는 중..." : "문의 보내기"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
