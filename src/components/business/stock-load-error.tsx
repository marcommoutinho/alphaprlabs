"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { cn } from "@/lib/utils";
import { BUSINESS_MAIN } from "./frame";

/** A6c's sentence: what is safe while the counts are missing. */
export const PAUSED_NOTE =
  "The server didn't respond. Sales and purchases are paused until counts load, so nothing is recorded against old numbers.";

/**
 * A6c Stock · couldn't load (§7.16 error): the real title, then the
 * `missed-tint` block with the icon well, the heading, what is safe, and a
 * full-width ink Try again. Counts are never shown stale, and no Record sale
 * or Record purchase is offered here: recording waits until they load.
 */
export function StockLoadError({
  title,
  heading,
  error,
  retry,
  back,
  note,
}: {
  title: React.ReactNode;
  heading: string;
  error: Error & { digest?: string };
  retry: () => void;
  back?: { href: string; label: string };
  /** What is safe meanwhile (default: A6c's recording note). */
  note?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={BUSINESS_MAIN} data-testid="business-error">
      {back ? (
        <div className="flex h-11 items-center pr-3 pl-1.5 laptop:hidden">
          <Link href={back.href} className="flex items-center text-[17px] text-signal-ink">
            <span aria-hidden className="mr-0.5 text-[26px] leading-none">‹</span>
            {back.label}
          </Link>
        </div>
      ) : null}
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">{title}</h1>
      </header>
      <LoadErrorPanel heading={heading} retry={retry} note={note} className="mx-3 mt-4 laptop:mx-0" />
    </main>
  );
}

/** A6c's block on its own (the screens above, and the component gallery). */
export function LoadErrorPanel({ heading, retry, note = PAUSED_NOTE, className }: { heading: string; retry: () => void; note?: string; className?: string }) {
  return (
    <section role="alert" className={cn("rounded-now bg-missed-tint px-5 pt-[22px] pb-5 laptop:max-w-[560px]", className)}>
      <span aria-hidden className="flex size-11 items-center justify-center rounded-[14px] bg-surface text-[20px] font-bold text-missed">
        !
      </span>
      <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">{heading}</h2>
      <p className="mt-1.5 text-[15px] leading-[1.45] text-ink-2">{note}</p>
      <Button variant="ink" size="lg" block className="mt-[18px] text-base" onClick={() => retry()}>
        <RefreshCw className="size-[18px]" aria-hidden />
        Try again
      </Button>
    </section>
  );
}
