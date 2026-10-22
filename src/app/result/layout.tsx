import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSocialMetadata } from "@/lib/site";

export const metadata: Metadata = {
  title: "오일픽 | 주유소 추천 결과",
  description: "입력한 경로를 기준으로 계산한 주유소 추천 결과를 확인합니다.",
  robots: { index: false, follow: true },
  ...createSocialMetadata({
    title: "오일픽 | 주유소 추천 결과",
    description: "입력한 경로를 기준으로 계산한 주유소 추천 결과를 확인합니다.",
    path: "/result",
  }),
};

export default function ResultLayout({ children }: { children: ReactNode }) {
  return children;
}
