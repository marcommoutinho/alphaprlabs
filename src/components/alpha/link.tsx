import NextLink from "next/link";
import type { ComponentProps } from "react";

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
 * and the route's skeleton shows while the page loads (shell/pending-nav.tsx),
 * and a tab visited in the last 30 s comes back from the router's cache
 * (staleTimes.dynamic, next.config.ts). tests/e2e/navigation.spec.ts moves
 * quickly through the tabs and cycle pages and fails on any prefetch request.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
