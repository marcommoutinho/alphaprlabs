"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { REFRESH_STALLED, type RefreshWait, waitForRefresh } from "@/lib/app/save";
import { useAlphaToast } from "./toast";

type Start = {
  /** What the answer said, before the stalled message ("Saved."). */
  lead: string;
  /** Stop being busy (the form usable again). */
  onGiveUp: () => void;
  /** Loads the page once more: router.refresh() unless given (e.g. the navigation again). Never the save. */
  retry?: () => void;
  /** Where Reload goes: this page unless given (e.g. the page a navigation was opening). */
  reloadTo?: string;
};

/**
 * The bounded wait for the refreshed page after a save the server answered
 * (waitForRefresh): start() when the screen stays busy for it, arrived()
 * when it's here; leaving the screen also stops it. On giving up, the error
 * toast says so and stays: "Saved. Couldn't load the latest version." ·
 * Reload (a full page load).
 */
export function useRefreshWait() {
  const router = useRouter();
  const toast = useAlphaToast();
  const current = useRef<RefreshWait | null>(null);
  useEffect(() => () => current.current?.arrived(), []);
  return useMemo(
    () => ({
      start({ lead, onGiveUp, retry, reloadTo }: Start) {
        current.current?.arrived();
        current.current = waitForRefresh({
          retry: retry ?? (() => router.refresh()),
          giveUp: () => {
            onGiveUp();
            toast.error({
              message: `${lead} ${REFRESH_STALLED}`,
              action: { label: "Reload", onAction: () => (reloadTo ? window.location.assign(reloadTo) : window.location.reload()) },
            });
          },
        });
      },
      arrived() {
        current.current?.arrived();
        current.current = null;
      },
    }),
    [router, toast],
  );
}
