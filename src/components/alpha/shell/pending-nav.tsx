"use client";

import { useLinkStatus } from "@/components/alpha/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { ROUTE_SKELETONS } from "./route-skeletons";

/** The navigation item whose page is on its way (its link was followed and hasn't committed yet). */
export type PendingNav = { key: string; href: string } | null;

type PendingNavValue = { pending: PendingNav; report: (key: string, href: string, on: boolean) => void };

const PendingNavContext = createContext<PendingNavValue>({ pending: null, report: () => {} });

/**
 * Instant feedback for the shell's navigation (the tab bar, the sidebar and
 * the Business links) while the private links don't prefetch
 * (src/components/alpha/link.tsx): until the server answers, nothing else on
 * screen would change. The link followed reports its pending state here
 * (NavLinkPending); from the next frame its item shows as current, and the
 * page area shows that route's loading skeleton (PendingOutlet) until the
 * navigation commits, when the route's own loading.tsx or the page takes over.
 */
export function PendingNavProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingNav>(null);
  const report = useCallback((key: string, href: string, on: boolean) => {
    setPending((current) => {
      if (on) return current?.key === key && current.href === href ? current : { key, href };
      return current?.key === key && current.href === href ? null : current;
    });
  }, []);
  const value = useMemo(() => ({ pending, report }), [pending, report]);
  return <PendingNavContext value={value}>{children}</PendingNavContext>;
}

export function usePendingNav(): PendingNav {
  return useContext(PendingNavContext).pending;
}

/**
 * Inside a navigation item's <Link>: mirrors the link's pending state
 * (useLinkStatus, set as the navigation starts) into the shell before the
 * browser paints. Next.js keeps only the last followed link pending, so a
 * second tap moves the feedback to the new item.
 */
export function NavLinkPending({ navKey, href }: { navKey: string; href: string }) {
  const { pending } = useLinkStatus();
  const { report } = useContext(PendingNavContext);
  useLayoutEffect(() => {
    if (!pending) return;
    report(navKey, href, true);
    return () => report(navKey, href, false);
  }, [pending, navKey, href, report]);
  return null;
}

/**
 * The shell's page area: the page, or, while a navigation item's page is on
 * its way, that route's skeleton (the same component as its loading.tsx) in
 * its place. The page stays mounted underneath, hidden, so a navigation that
 * never commits leaves it as it was. Following the page already shown
 * changes nothing.
 */
export function PendingOutlet({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pending = usePendingNav();
  const Skeleton = pending && pending.href !== pathname ? ROUTE_SKELETONS[pending.key] : undefined;
  useLayoutEffect(() => {
    // The new page opens at its top, as it will once it commits.
    if (Skeleton) window.scrollTo(0, 0);
  }, [Skeleton]);
  return (
    <>
      <div className={Skeleton ? "hidden" : "contents"}>{children}</div>
      {Skeleton ? <Skeleton /> : null}
    </>
  );
}
