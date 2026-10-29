"use client";

import { useState } from "react";
import { ChevronRight, CircleHelp, Headphones, X } from "lucide-react";
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

export const OILPICK_FAQ_URL =
  "https://bouncy-servant-ff6.notion.site/OilPick-FAQ-dff8837e6bef824b8c7381e6056b1278";

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
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
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
              className="border-0 bg-transparent text-text-body hover:bg-route-sky hover:text-route-strong md:h-9 md:w-auto md:gap-1.5 md:border md:border-route-strong/20 md:bg-surface md:px-3"
            />
          }
        >
          <CircleHelp className="size-5" aria-hidden />
          <span className="hidden md:inline">도움말</span>
        </DrawerTrigger>
        <DrawerContent className="rounded-t-card border-route-strong/15 bg-surface sm:mx-auto sm:max-w-md">
          <DrawerHeader className="flex flex-row items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-4 text-left">
            <div className="flex items-center gap-2">
              <DrawerTitle className="text-text-strong">도움말</DrawerTitle>
            </div>
            <DrawerClose
              render={
                <button
                  type="button"
                  aria-label="도움말 닫기"
                  className="rounded-control-sm p-1.5 text-text-body hover:bg-route-sky hover:text-route-strong"
                />
              }
            >
              <X className="size-6" aria-hidden />
            </DrawerClose>
          </DrawerHeader>

          <div className="flex flex-col gap-3 bg-surface px-4 pb-6 pt-4">
            <a
              href={OILPICK_FAQ_URL}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-16 items-center gap-3 rounded-card border border-route-strong/15 bg-surface px-4 text-left shadow-route-sm transition-colors hover:border-route-cyan hover:bg-route-sky active:scale-[0.99]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control-sm bg-route-sky text-route-strong">
                <CircleHelp className="size-5" aria-hidden />
              </span>
              <span className="flex-1 text-base font-semibold text-text-strong">
                자주 묻는 질문
              </span>
              <ChevronRight
                className="size-5 text-text-body transition-colors group-hover:text-route-strong"
                aria-hidden
              />
            </a>

            <button
              type="button"
              className="group flex min-h-16 items-center gap-3 rounded-card border border-route-strong/15 bg-surface px-4 text-left shadow-route-sm transition-colors hover:border-route-cyan hover:bg-route-sky active:scale-[0.99]"
              onClick={openFeedback}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control-sm bg-route-sky text-route-strong">
                <Headphones className="size-5" aria-hidden />
              </span>
              <span className="flex-1 text-base font-semibold text-text-strong">
                서비스 문의
              </span>
              <ChevronRight
                className="size-5 text-text-body transition-colors group-hover:text-route-strong"
                aria-hidden
              />
            </button>
          </div>
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
