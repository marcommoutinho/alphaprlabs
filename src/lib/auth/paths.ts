// Auth routes and role-aware destinations. Pure: shared by the proxy, server
// code and tests.
import type { AppRole } from "@/lib/app/identity";

/**
 * Home of the research side (Today). Every signed-in person lands here —
 * admins too, since every admin is also a researcher (S3.2). The app host's
 * "/" and "/app" land here.
 */
export const RESEARCH_HOME = "/app/today";

/** Home of the admin back office, reached from the account menu's "Admin" item. */
export const ADMIN_HOME = "/admin/inventory";

export const SIGN_IN_PATH = "/auth";
export const RECOVER_PATH = "/auth/recover";
export const RESET_PASSWORD_PATH = "/auth/reset";
export const ACKNOWLEDGE_PATH = "/auth/acknowledge";

/** Version of the researcher disclaimer text shown at ACKNOWLEDGE_PATH. */
export const ACKNOWLEDGEMENT_VERSION = "2026-09-placeholder";

/**
 * The push permission prompt ("Turn on dose reminders"): shown once, on the
 * first standalone (home screen) launch, and on request from Me. Researchers
 * and admins.
 */
export const REMINDERS_READINESS_PATH = "/auth/reminders";

/**
 * R16 Put Alpha on your Home Screen (step 3 of 3): iPhone / iPad Safari
 * only; anywhere else (or already running from the Home Screen) it goes
 * straight on to Today.
 */
export const INSTALL_PATH = "/auth/install";

/** Where a researcher goes right after agreeing to R15 (end of joining): R16. */
export const AFTER_ACKNOWLEDGEMENT_PATH = INSTALL_PATH;

/**
 * A same-site return path from `?next=`, or null. Only paths inside /app or
 * /admin are accepted, so it can never redirect off the app host.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s]/.test(next)) return null;
  const path = next.split(/[?#]/)[0];
  return path === "/app" || path.startsWith("/app/") || path === "/admin" || path.startsWith("/admin/")
    ? next
    : null;
}

/** True when `path` is `area` itself or inside it (a sub-path, query or fragment). */
const inArea = (path: string, area: string) =>
  path === area || path.startsWith(`${area}/`) || path.startsWith(`${area}?`) || path.startsWith(`${area}#`);

/**
 * The landing page for a signed-in person: their return path if they may use
 * it, else Today. The research side (/app) needs the acknowledgement first;
 * the admin back office (/admin) is for admins only and does not.
 */
export function destinationFor(
  person: { role: AppRole; acknowledged: boolean },
  next?: string | null,
): string {
  const safe = safeNextPath(next);
  if (safe && person.role === "admin" && inArea(safe, "/admin")) return safe;
  if (!person.acknowledged) return ACKNOWLEDGE_PATH;
  if (safe && inArea(safe, "/app")) return safe;
  return RESEARCH_HOME;
}

/** Sign-in URL that returns to `pathname` afterwards and, if a session lapsed, says so. */
export function signInUrl({ next, expired }: { next?: string | null; expired?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (expired) params.set("expired", "1");
  const safe = safeNextPath(next);
  if (safe) params.set("next", safe);
  const query = params.toString();
  return query ? `${SIGN_IN_PATH}?${query}` : SIGN_IN_PATH;
}
