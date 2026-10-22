import type { Metadata, Viewport } from "next";
import type React from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MOBILE_UA_PATTERN } from "@/lib/mobile-ua-pattern";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  applicationName: SITE_NAME,
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: "#3182F6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ko"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      {/* data-mobile-ua는 아래 스크립트가 하이드레이션 전에 찍어서 서버 마크업과 의도적으로 다름 */}
      <head>
        {/* body 페인트 전에 UA 판정을 html 속성으로 찍고 CSS([data-desktop-only])로만 토글 — 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(/${MOBILE_UA_PATTERN}/i.test(navigator.userAgent)||(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1))document.documentElement.setAttribute('data-mobile-ua','1')`,
          }}
        />

        {/* 지도 컴포넌트의 useKakaoLoader가 SDK를 단일 경로로 로드한다. */}
        <link rel="preconnect" href="https://dapi.kakao.com" />
        <link rel="dns-prefetch" href="https://dapi.kakao.com" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
