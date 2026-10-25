import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Navigation, PiggyBank, SlidersHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { createSocialMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";

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
  {
    Icon: SlidersHorizontal,
    text: "균형·최소비용·최단거리 중 원하는 기준으로",
  },
];

export default function LandingPage() {
  return (
    <main className="relative isolate flex min-h-screen w-full overflow-hidden bg-[#fbfdff]">
      <div className="pointer-events-none absolute inset-y-0 right-0 z-0 hidden w-[68vw] min-w-[760px] max-w-[2600px] xl:block">
        <Image
          src="/brand/landing-background.png"
          alt="경로와 추천 주유소를 보여주는 오일픽 지도 화면"
          aria-hidden
          fill
          priority
          sizes="68vw"
          unoptimized
          className="object-cover object-right"
        />
        <div className="absolute inset-y-0 left-0 w-[34%] bg-gradient-to-r from-[#fbfdff] via-[#fbfdff]/90 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1480px] items-center justify-center px-6 py-16 sm:px-10 xl:justify-start xl:px-0">
        <section className="flex w-full max-w-[640px] flex-col items-start text-left xl:w-[52%] xl:py-10">
          <div className="flex items-center gap-2">
            <Image src="/icon.svg" width={42} height={42} alt="" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element -- 벡터 워드마크, next/image svg 최적화 미지원 */}
            <img
              src="/brand/wordmark.svg"
              width={290}
              height={116}
              alt="오일픽"
              className="h-7 w-auto"
            />
          </div>

          <p className="mt-14 text-base font-bold text-primary">
            경로 위 주유소 찾기
          </p>

          <h1 className="mt-4 text-[clamp(2rem,3.1vw,2.75rem)] font-extrabold leading-[1.3] tracking-tight text-balance">
            가는 길에 있는 주유소를
            <br />
            <span className="text-primary">오일픽</span>이 대신 찾아드려요
          </h1>

          <p className="mt-5 max-w-[600px] text-lg leading-[1.65] text-muted-foreground">
            경로에 딱 맞는 주유소가 없으면, 최소한으로 돌아가는 최적 경로까지
            알려드려요.
          </p>

          <ul className="mt-8 flex flex-col gap-3.5">
            {VALUE_PROPS.map(({ Icon, text }) => (
              <li
                key={text}
                className="flex items-center gap-2.5 text-base text-muted-foreground"
              >
                <Icon
                  className="size-[18px] shrink-0 text-primary"
                  aria-hidden
                />
                {text}
              </li>
            ))}
            <li className="flex items-center gap-2.5 text-base text-muted-foreground">
              <Navigation
                className="size-[18px] shrink-0 text-primary"
                aria-hidden
              />
              카카오맵·네이버지도·티맵으로 바로 길안내
              <span data-desktop-only className="text-muted-foreground/70">
                (티맵은 모바일에서만)
              </span>
            </li>
          </ul>

          <Link
            href="/home"
            prefetch={false}
            className={buttonVariants({
              size: "xl",
              className:
                "mt-10 h-[56px] w-full max-w-[604px] rounded-2xl text-xl",
            })}
          >
            지금 경로 찾기
          </Link>
        </section>
      </div>
    </main>
  );
}
