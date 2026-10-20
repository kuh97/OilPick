"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Headphones,
  X,
} from "lucide-react";
import { FeedbackDialog } from "@/components/feedback-dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import type { FeedbackSource } from "@/lib/api/useFeedback";

type HelpView = "menu" | "faq";

export function HelpDrawer({
  feedbackSource,
  stationId,
  stationName,
  searchId,
  originName,
  destinationName,
}: {
  feedbackSource?: FeedbackSource;
  stationId?: string;
  stationName?: string;
  searchId?: string;
  originName?: string;
  destinationName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<HelpView>("menu");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setView("menu");
  }

  function openFeedback() {
    setOpen(false);
    setFeedbackOpen(true);
  }

  return (
    <>
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="도움말"
              title="도움말"
            />
          }
        >
          <CircleHelp className="size-5" aria-hidden />
        </DrawerTrigger>
        <DrawerContent className="sm:mx-auto sm:max-w-md">
          <DrawerHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              {view === "faq" && (
                <button
                  type="button"
                  aria-label="도움말 메뉴로 돌아가기"
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setView("menu")}
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
              )}
              <DrawerTitle>
                {view === "faq" ? "자주 묻는 질문" : "도움말"}
              </DrawerTitle>
            </div>
            <DrawerClose
              render={
                <button
                  type="button"
                  aria-label="도움말 닫기"
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                />
              }
            >
              <X className="size-6" aria-hidden />
            </DrawerClose>
          </DrawerHeader>

          {view === "menu" ? (
            <div className="flex flex-col gap-3 px-4 pb-6">
              <button
                type="button"
                className="flex min-h-20 items-center gap-4 rounded-xl border border-border bg-card px-4 text-left transition-colors hover:bg-muted active:scale-[0.99]"
                onClick={() => setView("faq")}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CircleHelp className="size-6" aria-hidden />
                </span>
                <span className="flex-1 text-lg font-medium">
                  자주 묻는 질문
                </span>
                <ChevronRight
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              </button>

              <button
                type="button"
                className="flex min-h-20 items-center gap-4 rounded-xl border border-border bg-card px-4 text-left transition-colors hover:bg-muted active:scale-[0.99]"
                onClick={openFeedback}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Headphones className="size-6" aria-hidden />
                </span>
                <span className="flex-1 text-lg font-medium">서비스 문의</span>
                <ChevronRight
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              </button>
            </div>
          ) : (
            <div className="px-4 pb-6">
              <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
                자주 묻는 질문은 준비 중이에요. Notion에 정리한 뒤 이곳에서
                보여드릴게요.
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <FeedbackDialog
        showTrigger={false}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        feedbackSource={feedbackSource}
        stationId={stationId}
        stationName={stationName}
        searchId={searchId}
        originName={originName}
        destinationName={destinationName}
      />
    </>
  );
}
