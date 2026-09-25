// One codebase, two hosts (plan: "Production readiness"):
//   app host    (APP_HOST, e.g. app.alphaprlabs.com / app.localhost:3000)
//               serves /app, /admin, /auth (+ /api); "/" goes to /app and
//               public pages go back to the public host.
//   public host (every other host) serves the reference site; /app, /admin
//               and /auth move to the app host.
// With APP_HOST unset nothing redirects, so plain localhost:3000 serves all.
//
// Locally PUBLIC_HOST must not be the dev server's own origin (localhost:3000):
// `next dev` / `next start` turn an absolute redirect to their own origin into
// a relative one, which would loop on the app host. Use www.localhost:3000.

const PRIVATE_PREFIXES = ["/app", "/admin", "/auth"] as const;
// Allowed on the app host without redirecting (route handlers added later).
const APP_HOST_PASSTHROUGH = ["/api"] as const;

export type HostConfig = {
  /** Host (with port if any) of the private app. Unset disables host routing. */
  appHost?: string;
  /** Host (with port if any) of the public site. Needed to send public pages back. */
  publicHost?: string;
};

export type HostRequest = {
  host: string;
  pathname: string;
  search: string;
  /** "http:" or "https:" */
  protocol: string;
};

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Returns the absolute URL to redirect to, or null to continue. */
export function hostRedirect(request: HostRequest, config: HostConfig): string | null {
  const appHost = config.appHost?.trim().toLowerCase();
  if (!appHost) return null;

  const host = request.host.trim().toLowerCase();
  const isPrivatePath = PRIVATE_PREFIXES.some((prefix) => under(request.pathname, prefix));
  const target = (toHost: string, pathname: string) =>
    `${request.protocol}//${toHost}${pathname}${request.search}`;

  if (host === appHost) {
    if (request.pathname === "/") return target(appHost, "/app");
    if (isPrivatePath || APP_HOST_PASSTHROUGH.some((prefix) => under(request.pathname, prefix))) return null;
    const publicHost = config.publicHost?.trim().toLowerCase();
    return publicHost ? target(publicHost, request.pathname) : null;
  }

  return isPrivatePath ? target(appHost, request.pathname) : null;
}
