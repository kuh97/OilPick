import { useSyncExternalStore } from "react";
import { MOBILE_UA_PATTERN } from "@/lib/mobile-ua-pattern";

const MOBILE_UA_REGEX = new RegExp(MOBILE_UA_PATTERN, "i");

/** 값이 마운트 후로도 바뀌지 않으므로 실제 구독은 필요 없다 — 리렌더를 유발하지 않는 no-op. */
function subscribeNever() {
  return () => {};
}
function getIsMobileSnapshot(): boolean {
  return (
    MOBILE_UA_REGEX.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}
function getIsMobileServerSnapshot(): boolean | null {
  return null;
}

/** 모바일 여부. 마운트 전엔 null(미확정) — false로 두면 모바일에서 PC용 UI가 잠깐 보였다 사라진다. */
export function useIsMobile(): boolean | null {
  return useSyncExternalStore(subscribeNever, getIsMobileSnapshot, getIsMobileServerSnapshot);
}
