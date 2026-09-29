// Preloaded into the Next.js server the e2e suite starts (playwright.config.ts,
// NODE_OPTIONS=--require): *.localhost resolves to loopback, as it does in
// Chromium and as app.localhost / www.localhost need to for host routing.
//
// Why: when a Server Action redirects (sign-in, for one), Next.js fetches the
// target page from its own origin, the request's Host (action-handler.js,
// createRedirectRenderResult), to send it with the action's answer. Node's
// resolver doesn't know app.localhost, so that fetch failed with ENOTFOUND,
// Next.js logged "failed to get redirect response", and the browser loaded
// the page itself: a slower redirect and log noise, test-only. In production
// the host is app.alphaprlabs.com, which resolves. The redirects themselves
// are unchanged.
const dns = require("node:dns");

const lookup = dns.lookup;
const LOCALHOST_SUBDOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost\.?$/i;

dns.lookup = function lookupLocalhost(hostname, ...rest) {
  return lookup.call(this, typeof hostname === "string" && LOCALHOST_SUBDOMAIN.test(hostname) ? "localhost" : hostname, ...rest);
};
