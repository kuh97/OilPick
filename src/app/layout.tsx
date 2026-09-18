import type { Metadata, Viewport } from "next";
import type React from "react";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MOBILE_UA_PATTERN } from "@/lib/mobile-ua-pattern";
import "./globals.css";

// docs/DESIGN.md §3이 지정한 폰트는 재배포 권리가 없어 그대로 쓸 수 없다 —
// 한국어 UI에 가장 널리 쓰이는 무료 오픈소스 대체 폰트인 Pretendard를 대신 쓴다.
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "오일픽",
  description: "출발지부터 목적지까지의 경로를 고려해 가장 합리적인 주유소를 찾아드립니다.",
};

export const viewport: Viewport = {
  themeColor: "#3182F6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} h-full antialiased`}
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
