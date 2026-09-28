"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/alpha/button";
import { clock12 } from "@/lib/alpha/format";
import { lastLoadedWall } from "@/components/research/today-loaded";

/**
 * R9c Today error: the `missed-tint` block alone, with Try again (re-renders
 * the segment on the server) and when Today last loaded on this device.
 */
export default function TodayError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    console.error(error);
    // sessionStorage is only readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(lastLoadedWall());
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-8 laptop:pt-6 laptop:pb-16">
      <header className="px-5 pt-2 laptop:px-0">
        <h1 className="mt-5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Today</h1>
      </header>
      <section role="alert" className="mx-3 mt-4 flex flex-col items-start rounded-[24px] bg-missed-tint px-5 py-6 laptop:mx-0 laptop:max-w-[640px]">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">Couldn&apos;t load today&apos;s plan</h2>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-2">Check your connection and try again. Everything you&apos;ve already logged is saved.</p>
        <Button variant="ink" size="md" className="mt-4" onClick={() => unstable_retry()}>
          Try again
        </Button>
        {loaded ? <p className="mt-3 font-mono text-[12px] text-ink-3">Last loaded {clock12(loaded)}</p> : null}
      </section>
    </main>
  );
}
