import { NextResponse, type NextRequest } from "next/server";
import { hostRedirect } from "@/lib/host-routing";

// Host routing only; authentication checks arrive with S2 and are always
// re-verified at the data operation, never trusted from this proxy alone.
export function proxy(request: NextRequest) {
  const location = hostRedirect(
    {
      host: request.headers.get("host") ?? request.nextUrl.host,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      protocol: request.nextUrl.protocol,
    },
    { appHost: process.env.APP_HOST, publicHost: process.env.PUBLIC_HOST },
  );
  return location ? NextResponse.redirect(location) : NextResponse.next();
}

export const config = {
  // Pages only: skip Next.js internals (assets, HMR, dev overlay) and any file
  // with an extension (images, favicon, and later the manifest and worker).
  matcher: ["/((?!_next/|__nextjs|.*\\..*).*)"],
};
