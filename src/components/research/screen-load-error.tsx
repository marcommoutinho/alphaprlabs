"use client";

import { useEffect } from "react";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { CYCLES_MAIN } from "./cycles/cycles-list";

/**
 * A research screen that couldn't load (R9c's pattern, as Cycles uses it):
 * the real title, then the `missed-tint` block with Try again (re-renders
 * the segment on the server). Nothing already logged is touched by a
 * failed read.
 */
export function ScreenLoadError({
  title,
  heading,
  error,
  retry,
  back,
}: {
  title: string;
  heading: string;
  error: Error & { digest?: string };
  retry: () => void;
  back?: { href: string; label: string };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={CYCLES_MAIN}>
      <header className="px-5 pt-2 laptop:px-0">
        {back ? (
          <Link href={back.href} className="text-[17px] text-signal-ink laptop:text-[14px]">
            ‹ {back.label}
          </Link>
        ) : null}
        <h1 className="mt-1 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">{title}</h1>
      </header>
      <section role="alert" className="mx-3 mt-4 flex flex-col items-start rounded-[24px] bg-missed-tint px-5 py-6 laptop:mx-0 laptop:max-w-[640px]">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{heading}</h2>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-2">Check your connection and try again. Everything you&apos;ve already logged is saved.</p>
        <Button variant="ink" size="md" className="mt-4" onClick={() => retry()}>
          Try again
        </Button>
      </section>
    </main>
  );
}
