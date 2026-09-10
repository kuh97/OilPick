import type { Metadata, Viewport } from "next";
import type React from "react";
import localFont from "next/font/local";
import Script from "next/script";
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

        {/* 거의 모든 화면(홈/결과/주유소 상세)이 카카오맵을 쓴다 — LCP 후보인 지도가
            하이드레이션 이후에야 SDK를 요청하며 생기는 워터폴을 없애기 위해, 하이드레이션을
            기다리지 않고 HTML 파싱 단계부터 SDK를 미리 받아둔다. useKakaoLoader는
            window.kakao.maps가 이미 있으면 새로 스크립트를 만들지 않고 그대로 재사용한다. */}
        <link rel="preconnect" href="https://dapi.kakao.com" />
        <link rel="dns-prefetch" href="https://dapi.kakao.com" />
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ""}&autoload=false`}
          strategy="beforeInteractive"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
