import { NextResponse, type NextRequest } from "next/server";
import { hostRedirect } from "@/lib/host-routing";
import { updateSession } from "@/lib/supabase/proxy";

const SESSION_PREFIXES = ["/app", "/admin", "/auth"];

// Host routing, then (private area only) the Supabase session refresh. Access
// is always re-verified in layouts, pages and server actions, never trusted
// from this proxy alone.
export async function proxy(request: NextRequest) {
  const location = hostRedirect(
    {
      host: request.headers.get("host") ?? request.nextUrl.host,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      protocol: request.nextUrl.protocol,
    },
    { appHost: process.env.APP_HOST, publicHost: process.env.PUBLIC_HOST },
  );
  if (location) return NextResponse.redirect(location);

  const { pathname } = request.nextUrl;
  if (SESSION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return updateSession(request);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: skip Next.js internals (assets, HMR, dev overlay) and any file
  // with an extension (images, favicon, and later the manifest and worker).
  matcher: ["/((?!_next/|__nextjs|.*\\..*).*)"],
};
