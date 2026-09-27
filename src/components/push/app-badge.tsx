"use client";

import { useEffect } from "react";
import { pendingDoseCount } from "@/app/(private)/app/today/actions";
import { onForeground } from "./use-reminders";

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Sets the installed app's icon badge to the number of doses awaiting
 * confirmation (a count on iPhone; some Android launchers show a dot), or
 * clears it at 0. The badge is a convenience, not a record; where the
 * Badging API is missing nothing happens.
 */
export function setAppBadge(count: number) {
  const nav = navigator as BadgingNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Badging API not supported here.
  }
}

/** Keeps the badge at `count` (Today renders it after every confirmation). */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => setAppBadge(count), [count]);
  return null;
}

/**
 * Mounted once by the research-side layout: reads the count when the app
 * opens and whenever it returns to the foreground, on any screen.
 */
export function BadgeSync() {
  useEffect(() => {
    let live = true;
    const run = () =>
      pendingDoseCount()
        .then((count) => {
          if (live && count !== null) setAppBadge(count);
        })
        .catch(() => {});
    void run();
    const stop = onForeground(() => void run());
    return () => {
      live = false;
      stop();
    };
  }, []);
  return null;
}
