"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Back/forward restores a page from the router's client cache without asking
 * the server, whatever staleTimes says (Next.js 16.3.7), so a page that checks
 * access on each request would come back as it was: a researcher history
 * after the share stopped, a peptide after it left the Library.
 *
 * Such a page renders a fresh id on every server render (crypto.randomUUID()
 * in the page). The first time that payload mounts it came straight from the
 * server; the same id mounting again is a restore. Only ids are kept, for
 * this tab.
 */
const shown = new Set<string>();

/** True when this server render was already on screen: this mount is a restore. Pure (a render may call it). */
export const wasShown = (id: string): boolean => shown.has(id);

/** Records that this server render is on screen (from an effect). */
export const markShown = (id: string): void => {
  shown.add(id);
};

/**
 * Whether this mount is a restore, decided once when it mounts: later renders
 * of the same payload are not restores, and a new id on the same mount (a
 * refresh) is always a fresh server render. A restore always mounts anew.
 */
export function useRestored(id: string): boolean {
  const [mount] = useState(() => ({ id, restored: wasShown(id) }));
  return mount.id === id && mount.restored;
}

/**
 * For pages where the previous payload may flash while the server answers
 * (the Library, a peptide): a restore asks the server again at once with
 * router.refresh(), and so does a page the browser itself kept (pageshow
 * persisted). Renders nothing.
 */
export function RefreshOnRestore({ id }: { id: string }) {
  const router = useRouter();
  const restored = useRestored(id);
  useEffect(() => {
    if (restored) router.refresh();
    markShown(id);
  }, [id, restored, router]);
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [router]);
  return null;
}
