// Preloaded into the Next.js server the e2e suite starts (playwright.config.ts,
// NODE_OPTIONS=--import): *.localhost resolves to loopback, as it does in
// Chromium and as app.localhost / www.localhost need to for host routing.
//
// Why: when a Server Action redirects, Next.js fetches the target page from
// its own origin, the request's Host (action-handler.js,
// createRedirectRenderResult), to send it with the action's answer. Node's
// resolver doesn't know app.localhost, so that fetch failed with ENOTFOUND,
// Next.js logged "failed to get redirect response", and the browser loaded
// the page itself. In production the host (app.alphaprlabs.com) resolves and
// the fetch succeeds, so without this the suite tested a path production never
// takes: it hid that the fetched page is rendered with the request's old
// cookies, which after a sign-in meant the sign-in form under /app/today (the
// auth actions now navigate from the form instead: see goTo in
// src/app/(private)/auth/actions.ts).
import dns from "node:dns";

const lookup = dns.lookup;
const LOCALHOST_SUBDOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost\.?$/i;

dns.lookup = function lookupLocalhost(hostname, ...rest) {
  return lookup.call(this, typeof hostname === "string" && LOCALHOST_SUBDOMAIN.test(hostname) ? "localhost" : hostname, ...rest);
};
