"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PITCH_SLIDES, clampPitchPage } from "@/content/pitch";

function ScreenSlide({ page, total }: { page: number; total: number }) {
  const slide = PITCH_SLIDES[page - 1];
  return (
    <section
      aria-label={`Slide ${page} of ${total}: ${slide.title}`}
      className="flex aspect-video w-full max-w-6xl flex-col justify-center gap-6 rounded-2xl bg-neutral-950 p-8 text-white shadow-xl sm:p-12"
    >
      <p className="text-sm font-medium tracking-widest text-white/50 uppercase">
        {page} / {total}
      </p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
        {slide.title}
      </h1>
      <ul className="flex flex-col gap-3 text-base leading-7 text-white/90 sm:text-xl sm:leading-9">
        {slide.bullets.map((line) => (
          <li key={line.slice(0, 48)} className="flex gap-3">
            <span aria-hidden="true" className="text-white/40">
              ▸
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Deck() {
  const params = useSearchParams();
  const router = useRouter();
  const total = PITCH_SLIDES.length;
  const page = clampPitchPage(params.get("p"), total);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && page < total) {
        router.push(`/pitch?p=${page + 1}`);
      } else if (e.key === "ArrowLeft" && page > 1) {
        router.push(`/pitch?p=${page - 1}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, router]);

  return (
    <>
      <div className="pitch-screen mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-4 px-4 py-8">
        <div className="flex w-full items-center justify-between gap-2">
          <Link
            href="/"
            className="text-sm text-black/60 hover:underline dark:text-white/60"
          >
            ← Home
          </Link>
          <p className="text-sm text-black/60 dark:text-white/60">
            Use ← → keys to move · print this page for the PDF slides
          </p>
        </div>

        <ScreenSlide page={page} total={total} />

        <nav
          aria-label="Slides"
          className="flex w-full flex-wrap items-center justify-between gap-3"
        >
          <div className="flex gap-2">
            <Link
              href={`/pitch?p=${page - 1}`}
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : undefined}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                page <= 1
                  ? "pointer-events-none border-black/10 text-black/30 dark:border-white/10 dark:text-white/30"
                  : "border-black/20 hover:border-black/50 dark:border-white/25 dark:hover:border-white/60"
              }`}
            >
              ← Prev
            </Link>
            <Link
              href={`/pitch?p=${page + 1}`}
              aria-disabled={page >= total}
              tabIndex={page >= total ? -1 : undefined}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                page >= total
                  ? "pointer-events-none border-black/10 text-black/30 dark:border-white/10 dark:text-white/30"
                  : "border-black/20 hover:border-black/50 dark:border-white/25 dark:hover:border-white/60"
              }`}
            >
              Next →
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PITCH_SLIDES.map((slide, i) => (
              <Link
                key={slide.title}
                href={`/pitch?p=${i + 1}`}
                aria-label={`Go to slide ${i + 1}: ${slide.title}`}
                aria-current={i + 1 === page ? "page" : undefined}
                className={`min-w-9 rounded-md px-2 py-1 text-center text-sm ${
                  i + 1 === page
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "border border-black/15 text-black/60 hover:border-black/40 dark:border-white/20 dark:text-white/60 dark:hover:border-white/50"
                }`}
              >
                {i + 1}
              </Link>
            ))}
          </div>
        </nav>
      </div>

      {/* Print version: all 10 slides, one landscape page each. */}
      <div className="pitch-print" aria-hidden="true">
        {PITCH_SLIDES.map((slide, i) => (
          <section key={slide.title} className="pitch-print-slide">
            <p className="pitch-print-counter">
              {i + 1} / {total}
            </p>
            <h1>{slide.title}</h1>
            <ul>
              {slide.bullets.map((line) => (
                <li key={line.slice(0, 48)}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <style>{`
        .pitch-print { display: none; }
        @page { size: landscape; margin: 0; }
        @media print {
          .pitch-screen { display: none !important; }
          footer { display: none !important; }
          body { background: #0a0a0a !important; }
          .pitch-print { display: block !important; }
          .pitch-print-slide {
            width: 100vw;
            height: 100vh;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 24px;
            padding: 48px 56px;
            background: #0a0a0a;
            color: #fff;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .pitch-print-slide:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .pitch-print-counter {
            font-size: 14px;
            letter-spacing: 0.2em;
            color: rgba(255, 255, 255, 0.5);
          }
          .pitch-print-slide h1 {
            font-size: 44px;
            line-height: 1.2;
            font-weight: 800;
            margin: 0;
          }
          .pitch-print-slide ul {
            display: flex;
            flex-direction: column;
            gap: 12px;
            font-size: 19px;
            line-height: 1.5;
            color: rgba(255, 255, 255, 0.9);
            margin: 0;
            padding-left: 24px;
          }
        }
      `}</style>
    </>
  );
}

export default function PitchPage() {
  return (
    <Suspense
      fallback={
        <div className="pitch-screen mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-4 px-4 py-8">
          <ScreenSlide page={1} total={PITCH_SLIDES.length} />
        </div>
      }
    >
      <Deck />
    </Suspense>
  );
}
