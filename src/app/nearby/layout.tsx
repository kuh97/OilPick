import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSocialMetadata } from "@/lib/site";

export const metadata: Metadata = {
  title: "오일픽 | 내 주변 주유소",
  description: "현재 위치 주변의 주유소 가격과 시설 정보를 확인합니다.",
  robots: { index: false, follow: true },
  ...createSocialMetadata({
    title: "오일픽 | 내 주변 주유소",
    description: "현재 위치 주변의 주유소 가격과 시설 정보를 확인합니다.",
    path: "/nearby",
  }),
};

export default function NearbyLayout({ children }: { children: ReactNode }) {
  return children;
}
