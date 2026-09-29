"use client";

import { WifiOff } from "lucide-react";
import { useOnline } from "@/components/alpha/online";

export const OFFLINE_BAR_TEXT = "You're offline. Changes need a connection.";

/**
 * The offline bar (N1): while the app can't reach the server (useOnline), a
 * slim `ink` strip docked on top of the tab bar on a phone, and at the top of
 * the content on a laptop. The polite live region stays mounted, so the
 * change is announced (it takes the status role while offline); the strip
 * goes with the connection's return. Toasts
 * sit above it (--offline-bar, app.css).
 */
export function OfflineBar() {
  const online = useOnline();
  return (
    <div
      // A status only while it says something (a toast is the page's other status).
      role={online ? undefined : "status"}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(55px+env(safe-area-inset-bottom))] z-40 laptop:static laptop:px-9 laptop:pt-5"
    >
      {online ? null : (
        <p
          data-slot="offline-bar"
          data-testid="offline-bar"
          className="flex h-9 items-center justify-center gap-2 bg-ink px-4 text-[13px] font-medium tracking-[-0.005em] text-surface laptop:justify-start laptop:rounded-[12px] laptop:px-4"
        >
          <WifiOff aria-hidden className="size-4 shrink-0 text-on-ink-2" strokeWidth={2.2} />
          <span className="truncate">{OFFLINE_BAR_TEXT}</span>
        </p>
      )}
    </div>
  );
}
