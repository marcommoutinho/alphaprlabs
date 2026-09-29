"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { isOnline, whenOnline } from "./online";

/** The followed link's pending state, for feedback inside it (src/components/alpha/shell/pending-nav.tsx). */
export { useLinkStatus } from "next/link";

/**
 * The private app's link: next/link with prefetching off by default. Every
 * private screen and shared private component imports this instead of
 * next/link (eslint.config.mjs enforces it); the public site keeps next/link.
 *
 * Why: in Next.js 16.2 and 16.3, a <Link> clicked while its prefetch is
 * still in flight can commit an empty segment (no page, no loading skeleton,
 * no error, an empty title) that stays until a reload: vercel/next.js#98684,
 * https://github.com/vercel/next.js/issues/98684. Still open for 16.3.7 (Sep
 * 2026): createCacheNodeForSegment (router-reducer/ppr-navigations.js) still
 * uses a Pending prefetch entry as a plain promise that resolves to null once
 * the entry is rejected, rather than as a cache miss. Pass `prefetch`
 * explicitly only once that is fixed in the version we run, and then run
 * tests/perf/prefetch-stress.spec.ts against a build with it on.
 *
 * With it off, a tap still answers on the next frame: the tab turns active
 * and the route's skeleton shows while the page loads (shell/pending-nav.tsx).
 * tests/e2e/navigation.spec.ts moves quickly through the tabs and cycle
 * pages and fails on any prefetch request.
 *
 * Offline (online.ts), a tap doesn't navigate: Next.js would fall back to a
 * full page load, the offline page. The offline bar says why, and the page
 * opens once the connection is back, if that is soon (LINK_WAIT_MS) and the
 * person is still on the page where they tapped it (followOnceOnline).
 */
export const LINK_WAIT_MS = 10_000;

/** Cancels the link tapped offline that waits for the connection, if any. */
let cancelPending: (() => void) | null = null;

/**
 * Follows `link` as a normal tap once the connection is back. Cancelled by a
 * later tap, by Back or Forward, after LINK_WAIT_MS, or when the page changed
 * meanwhile (another URL, or the link is gone): never a navigation later
 * than the person expects.
 */
function followOnceOnline(link: HTMLAnchorElement) {
  cancelPending?.();
  const from = window.location.href;
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener("popstate", stop);
    cancelFollow();
    if (cancelPending === stop) cancelPending = null;
  };
  const cancelFollow = whenOnline(() => {
    const stillHere = window.location.href === from && link.isConnected;
    stop();
    if (stillHere) link.click();
  });
  const timer = setTimeout(stop, LINK_WAIT_MS);
  window.addEventListener("popstate", stop);
  cancelPending = stop;
}

export default function Link({ prefetch = false, onClick, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink
      prefetch={prefetch}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        // Any other tap replaces a link still waiting for the connection.
        cancelPending?.();
        if (event.defaultPrevented || isOnline()) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
        event.preventDefault();
        followOnceOnline(event.currentTarget);
      }}
    />
  );
}
