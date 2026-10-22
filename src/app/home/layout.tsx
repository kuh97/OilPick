import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "오일픽 | 경로 찾기",
  description: "출발지와 목적지, 연료를 입력해 가는 길의 주유소를 찾습니다.",
  robots: { index: false, follow: true },
};

export default function HomeLayout({ children }: { children: ReactNode }) {
  return children;
}
