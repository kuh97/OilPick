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
import { useFeedback } from "@/lib/api/useFeedback";

const EMPTY_FORM = { email: "", subject: "", content: "" };

export function FeedbackDialog({
  buttonLabel = "서비스 문의",
  stationId,
  searchId,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
}: {
  buttonLabel?: string;
  stationId?: string;
  searchId?: string;
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
      stationId,
      searchId,
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
      <DialogContent>
        {submitted ? (
          <>
            <DialogHeader>
              <DialogTitle>문의가 접수됐어요</DialogTitle>
              <DialogDescription>확인 후 입력한 이메일로 답변드릴게요.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button />}>닫기</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>서비스 문의</DialogTitle>
              <DialogDescription>불편한 점이나 잘못된 정보를 알려주세요.</DialogDescription>
            </DialogHeader>

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
                  className="rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                제목
                <input
                  required
                  maxLength={120}
                  className="rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
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
                  className="resize-y rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  value={form.content}
                  onChange={(event) => updateField("content", event.target.value)}
                />
              </label>
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>취소</DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "보내는 중..." : "문의 보내기"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
