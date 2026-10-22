import type { Metadata } from "next";
import Link from "next/link";
import { Navigation, PiggyBank, SlidersHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  createSocialMetadata,
  SITE_DESCRIPTION,
  SITE_TITLE,
} from "@/lib/site";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  ...createSocialMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  }),
};

const VALUE_PROPS = [
  { Icon: PiggyBank, text: "얼마나 이득인지 원 단위로 보여드려요" },
  { Icon: SlidersHorizontal, text: "균형·최소비용·최단거리 중 원하는 기준으로" },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 100 100" width="32" height="32" aria-hidden>
          <rect width="100" height="100" rx="22" ry="22" fill="#3182F6" />
          <g transform="translate(50,50) scale(0.8) translate(-50,-50)">
            <path
              d="M50 8 C33 30 22 46 22 64 C22 79.46 34.54 92 50 92 C65.46 92 78 79.46 78 64 C78 46 67 30 50 8 Z"
              fill="#FFFFFF"
            />
            <g transform="translate(39,47) scale(0.42)">
              <path
                d="M50 8 C33 30 22 46 22 64 C22 79.46 34.54 92 50 92 C65.46 92 78 79.46 78 64 C78 46 67 30 50 8 Z"
                fill="#E8963C"
              />
            </g>
          </g>
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element -- 벡터 워드마크, next/image svg 최적화 미지원 */}
        <img
          src="/brand/wordmark.svg"
          width={290}
          height={116}
          alt="오일픽"
          className="h-5 w-auto"
        />
      </div>

      <p className="mt-10 text-sm font-bold text-primary">경로 위 주유소 찾기</p>

      <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-balance">
        가는 길에 있는 주유소를
        <br />
        <span className="text-primary">오일픽</span>이 대신 찾아드려요
      </h1>

      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        경로에 딱 맞는 주유소가 없으면, 최소한으로 돌아가는 최적 경로까지 알려드려요.
      </p>

      <ul className="mt-6 flex flex-col gap-2.5">
        {VALUE_PROPS.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="size-4 shrink-0 text-primary" aria-hidden />
            {text}
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <Navigation className="size-4 shrink-0 text-primary" aria-hidden />
          카카오맵·네이버지도·티맵으로 바로 길안내
          <span data-desktop-only className="text-muted-foreground/70">(티맵은 모바일에서만)</span>
        </li>
      </ul>

      <Link
        href="/home"
        prefetch={false}
        className={buttonVariants({ size: "xl", className: "mt-8 w-full" })}
      >
        지금 경로 찾기
      </Link>
    </main>
  );
}
