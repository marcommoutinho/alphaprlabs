import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { signInUrl } from "@/lib/auth/paths";
import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

const PROTECTED_PREFIXES = ["/app", "/admin"];

const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** A Supabase session cookie (possibly chunked), not the PKCE code verifier. */
const isSessionCookie = (name: string) =>
  name.startsWith("sb-") && /-auth-token(\.\d+)?$/.test(name);

/**
 * Supabase SSR session refresh (proxy pattern): validates the session cookie
 * and rewrites it when the access token was refreshed, so Server Components
 * see a current session. Also an optimistic redirect to sign-in for /app and
 * /admin without a session. This is not authorization: layouts, pages and
 * every server action re-check the person and role themselves.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const hadSession = request.cookies.getAll().some(({ name }) => isSessionCookie(name));
  // Do not run code between createServerClient and getClaims (Supabase SSR guidance).
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  if (!data?.claims && PROTECTED_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    const target = new URL(signInUrl({ next: `${pathname}${search}`, expired: hadSession }), request.url);
    const redirect = NextResponse.redirect(target);
    // Carry any cookie changes (e.g. clearing a dead session) onto the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
