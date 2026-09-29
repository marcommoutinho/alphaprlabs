"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { REFRESH_STALLED, refreshWaits } from "@/lib/app/save";
import { useAlphaToast } from "./toast";

type Start = {
  /** Which of the screen's waits (one per key: see refreshWaits); unnamed, the screen's one wait. */
  key?: string;
  /** What the answer said, before the stalled message ("Saved."); a function is read on giving up. */
  lead: string | (() => string);
  /** What the screen does on giving up (e.g. stop being busy). */
  onGiveUp: () => void;
  /** A navigation to run now and again as the retry (never the save); none: the action's refresh is on its way, and the retry is router.refresh(). */
  load?: () => void;
  /** Where Reload goes: this page unless given (e.g. the page a navigation was opening). */
  reloadTo?: string;
};

/**
 * The bounded wait for the refreshed page after a save the server answered
 * (waitForRefresh), for this screen only (refreshWaits): start() when the
 * screen stays busy for it (it does nothing, not even `load`, once the
 * screen is gone), arrived() when it's here; leaving the screen stops it.
 * On giving up, the error toast says so and stays: "Saved. Couldn't load
 * the latest version." · Reload (a full page load).
 */
export function useRefreshWait() {
  const router = useRouter();
  const toast = useAlphaToast();
  const [waits] = useState(() => refreshWaits());
  useEffect(() => {
    waits.mount();
    return () => waits.unmount();
  }, [waits]);
  return useMemo(
    () => ({
      start: ({ key, lead, onGiveUp, load, reloadTo }: Start) =>
        waits.start({
          key,
          load,
          refresh: () => router.refresh(),
          giveUp: () => {
            onGiveUp();
            toast.error({
              message: `${typeof lead === "function" ? lead() : lead} ${REFRESH_STALLED}`,
              action: { label: "Reload", onAction: () => (reloadTo ? window.location.assign(reloadTo) : window.location.reload()) },
            });
          },
        }),
      arrived: (key?: string) => waits.arrived(key),
    }),
    [router, toast, waits],
  );
}
