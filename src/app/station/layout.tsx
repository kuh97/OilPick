import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSocialMetadata } from "@/lib/site";

export const metadata: Metadata = {
  title: "오일픽 | 주유소 상세",
  description: "선택한 주유소의 가격, 주소, 시설과 길안내 정보를 확인합니다.",
  robots: { index: false, follow: true },
  ...createSocialMetadata({
    title: "오일픽 | 주유소 상세",
    description: "선택한 주유소의 가격, 주소, 시설과 길안내 정보를 확인합니다.",
    path: "/station",
  }),
};

export default function StationLayout({ children }: { children: ReactNode }) {
  return children;
}
