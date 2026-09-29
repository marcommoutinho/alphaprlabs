import NextLink from "next/link";
import type { ComponentProps } from "react";

/** The followed link's pending state, for feedback inside it (src/components/alpha/shell/pending-nav.tsx). */
export { useLinkStatus } from "next/link";

/**
 * The private app's link: next/link with prefetching off by default. Every
 * private screen and shared private component imports this instead of
 * next/link (eslint.config.mjs enforces it); the public site keeps next/link.
 *
 * Why: in Next.js 16.2 (and 16.3), a <Link> clicked while its prefetch is
 * still in flight can commit an empty segment (no page, no loading skeleton,
 * no error) that stays until a reload: vercel/next.js#98684,
 * https://github.com/vercel/next.js/issues/98684. The private app's pages are
 * dynamic and per person, so prefetching saved little; with it off a click
 * fetches the page once and shows the route's loading.tsx meanwhile. Pass
 * `prefetch` explicitly only once that issue is fixed in the version we run.
 * tests/e2e/navigation.spec.ts moves quickly through the tabs and cycle
 * pages and fails on any prefetch request.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
