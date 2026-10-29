import type { Metadata } from "next";
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
  {
    Icon: PiggyBank,
    text: "주유비를 얼마나 아끼는지 원 단위로 계산",
  },
  {
    Icon: SlidersHorizontal,
    text: "추천·최소비용·최단거리 중 원하는 기준으로",
  },
];

export default function LandingPage() {
  return (
    <main className="relative isolate flex min-h-[100svh] w-full overflow-hidden bg-black">
      <video
        aria-hidden
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 size-full object-cover"
      >
        <source src="/brand/onboarding.mp4" type="video/mp4" />
      </video>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/60"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/45"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1480px] items-center justify-center px-6 py-12 sm:px-10">
        <section className="flex w-full max-w-[680px] flex-col items-center text-center">
          <p className="text-base font-bold text-brand-amber">
            어디서 주유할지 고민될 때
          </p>

          <h1 className="mt-4 text-[clamp(2rem,5vw,3.5rem)] font-extrabold leading-[1.2] tracking-tight text-balance text-white">
            가는 길에 있는 주유소를
            <br />
            <span className="text-brand-amber">오일픽</span>이 대신 찾아드려요
          </h1>

          <p className="mt-5 max-w-[600px] text-base leading-[1.65] text-white/80 sm:text-lg">
            가는 길에 있는 주유소부터, 조금 돌아가도 괜찮은 곳까지 찾아드려요.
          </p>

          <ul className="mt-8 flex w-full max-w-[560px] flex-col items-center gap-3.5">
            {VALUE_PROPS.map(({ Icon, text }) => (
              <li
                key={text}
                className="flex w-full items-center justify-center gap-2.5 text-center text-base text-white/90"
              >
                <Icon
                  className="size-[18px] shrink-0 text-brand-amber"
                  aria-hidden
                />
                {text}
              </li>
            ))}
            <li className="flex w-full items-center justify-center gap-2.5 text-center text-base text-white/90">
              <Navigation
                className="size-[18px] shrink-0 text-brand-amber"
                aria-hidden
              />
              카카오맵·네이버지도·티맵으로 바로 길안내
              <span data-desktop-only className="text-white/60">
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
                "mt-10 h-14 w-full max-w-[604px] rounded-action bg-brand-amber text-brand-amber-foreground text-xl shadow-none hover:bg-brand-amber-strong focus-visible:ring-brand-amber",
            })}
          >
            지금 경로 찾기
          </Link>
        </section>
      </div>
    </main>
  );
}
