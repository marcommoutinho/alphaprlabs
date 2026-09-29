"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "@/components/alpha/link";
import { isOnline } from "./online";

/**
 * True when Back has an earlier page of this app to return to. The
 * Navigation API knows (same-origin entries only, so never the public site
 * or another site); where it's missing, the page was reached by a tap inside
 * the app when the address differs from the one the document was loaded at.
 */
export function canGoBackInApp(): boolean {
  const navigation = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
  if (typeof navigation?.canGoBack === "boolean") return navigation.canGoBack;
  const loaded = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!loaded) return false;
  const first = new URL(loaded.name);
  return first.pathname + first.search !== window.location.pathname + window.location.search;
}

/**
 * "‹ Back" for a page reached from several places (the vial calculator:
 * Cycles, Me, a cycle's mix row): goes back in history when there is an
 * earlier page of the app, else to `fallback` (also the link's address, so
 * it works before hydration and opens in a new tab). Offline it is a plain
 * link, which waits for the connection (alpha/link).
 */
export function HistoryBackBar({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <div className="flex h-11 items-center pr-3 pl-1.5 laptop:mb-2 laptop:h-auto laptop:pl-0">
      <Link
        href={fallback}
        className="flex items-center gap-0.5 text-[17px] text-signal-ink laptop:text-[15px]"
        data-testid="back-link"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (!isOnline() || !canGoBackInApp()) return;
          event.preventDefault();
          router.back();
        }}
      >
        <ChevronLeft className="size-[26px] laptop:size-5" aria-hidden />
        {label}
      </Link>
    </div>
  );
}
