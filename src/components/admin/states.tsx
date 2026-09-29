"use client";

import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import Link from "@/components/alpha/link";
import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { LoadErrorPanel } from "@/components/business/stock-load-error";
import { cn } from "@/lib/utils";

// Loading and error states of the V7 admin screens (Library, Templates,
// People, a researcher's history), in the v3 style of A6b / A6c: the real
// title at once, placeholders at real row height, and on failure the
// missed-tint block with Try again. Nothing is shown stale.

/** What a failed read means for the content screens: nothing was changed. */
export const READ_FAILED_NOTE = "The server didn't respond. Nothing was changed; try again in a moment.";

/** The phone's back bar ("‹ Business", "‹ People"). */
export function BackBar({ href, label, children }: { href: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-11 items-center justify-between pr-3 pl-1.5 laptop:hidden">
      <Link href={href} className="flex items-center gap-0.5 text-[17px] text-signal-ink">
        <ChevronLeft className="size-[26px]" aria-hidden />
        {label}
      </Link>
      {children}
    </div>
  );
}

/** Row placeholders at a list's real row height (60 px), inside a group. */
export function SkeletonRows({ count = 6, className, height = "h-[60px]" }: { count?: number; className?: string; height?: string }) {
  return (
    <div className={cn("divide-y divide-line overflow-hidden rounded-group border border-line bg-surface", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3 px-4", height)}>
          <div className="flex-1">
            <Skeleton className="h-4 w-[45%] rounded-[4px]" />
            <Skeleton className="mt-2 h-3 w-[60%] rounded-[4px]" />
          </div>
          <Skeleton className="h-4 w-14 rounded-[4px]" />
        </div>
      ))}
    </div>
  );
}

/** A9 / D6's editor while it loads: the phone's full-screen frame, the laptop pane. */
export function EditorSkeleton({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper pt-[env(safe-area-inset-top)] laptop:sticky laptop:top-0 laptop:z-auto laptop:h-dvh laptop:pt-0">
      <SkeletonRegion label={label} className="flex min-h-0 flex-1 flex-col">
        <div className="h-11 laptop:hidden" />
        <div className="flex flex-col gap-4 px-4 pt-3 laptop:px-8 laptop:pt-6">
          <Skeleton className="h-4 w-[220px] rounded-[4px]" />
          <Skeleton className="hidden h-8 w-[260px] rounded-[6px] laptop:block" />
          <Skeleton className="h-[52px] rounded-[14px] laptop:h-[46px]" />
          <Skeleton className="h-10 w-[180px] rounded-[10px]" />
          <Skeleton className="h-[52px] rounded-[14px] laptop:h-[46px]" />
          <Skeleton className="h-[116px] rounded-[14px] laptop:h-[150px]" />
        </div>
        <div className="mt-auto border-t border-line px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] laptop:px-8 laptop:py-4">
          <Skeleton className="h-14 rounded-btn laptop:ml-auto laptop:h-11 laptop:w-[200px]" />
        </div>
      </SkeletonRegion>
    </div>
  );
}

/** A screen that couldn't load: its title, then the A6c block. */
export function ScreenError({
  title,
  heading,
  error,
  retry,
  back,
  className,
}: {
  title: string;
  heading: string;
  error: Error & { digest?: string };
  retry: () => void;
  back?: { href: string; label: string };
  className?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={cn("mx-auto flex w-full max-w-[1200px] flex-col pb-24 laptop:px-9 laptop:pt-7", className)} data-testid="admin-error">
      {back ? <BackBar href={back.href} label={back.label} /> : null}
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">{title}</h1>
      </header>
      <LoadErrorPanel heading={heading} retry={retry} note={READ_FAILED_NOTE} className="mx-3 mt-4 laptop:mx-0" />
    </main>
  );
}

/** The editor pane (or the phone's full screen) couldn't load; the list beside it stays. */
export function PaneError({ heading, error, retry, back }: { heading: string; error: Error & { digest?: string }; retry: () => void; back: { href: string; label: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper pt-[env(safe-area-inset-top)] laptop:sticky laptop:top-0 laptop:z-auto laptop:h-dvh laptop:pt-0" data-testid="admin-error">
      <BackBar href={back.href} label={back.label} />
      <LoadErrorPanel heading={heading} retry={retry} note={READ_FAILED_NOTE} className="mx-3 mt-2 laptop:mx-8 laptop:mt-8" />
    </div>
  );
}
