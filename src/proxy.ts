import { NextResponse, type NextRequest } from "next/server";
import { hostRedirect, isAppFileOffAppHost } from "@/lib/host-routing";
import { updateSession } from "@/lib/supabase/proxy";

const SESSION_PREFIXES = ["/app", "/admin", "/auth"];

// Host routing, then (private area only) the Supabase session refresh. Access
// is always re-verified in layouts, pages and server actions, never trusted
// from this proxy alone.
export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const hosts = { appHost: process.env.APP_HOST, publicHost: process.env.PUBLIC_HOST };
  const { pathname } = request.nextUrl;

  // The installable app's files exist only on the app host.
  if (isAppFileOffAppHost({ host, pathname }, hosts)) return new NextResponse(null, { status: 404 });

  const location = hostRedirect(
    { host, pathname, search: request.nextUrl.search, protocol: request.nextUrl.protocol },
    hosts,
  );
  if (location) return NextResponse.redirect(location);

  if (SESSION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return updateSession(request);
  }
  return NextResponse.next();
}

export const config = {
  // Pages, plus the installable app's files (app host only). Skips Next.js
  // internals (assets, HMR, dev overlay) and any other file with an extension.
  matcher: ["/((?!_next/|__nextjs|.*\\..*).*)", "/sw.js", "/manifest.webmanifest", "/app-icons/:path*", "/offline.html"],
};
