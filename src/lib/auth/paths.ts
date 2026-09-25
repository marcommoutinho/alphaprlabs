// Auth routes and role-aware destinations. Pure: shared by the proxy, server
// code and tests.
import type { AppRole } from "@/lib/app/identity";

/** Role-aware home: the app host's "/" and "/app" land here. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin/inventory",
  researcher: "/app/today",
};

export const SIGN_IN_PATH = "/auth";
export const RECOVER_PATH = "/auth/recover";
export const RESET_PASSWORD_PATH = "/auth/reset";
export const ACKNOWLEDGE_PATH = "/auth/acknowledge";

/** Version of the researcher disclaimer text shown at ACKNOWLEDGE_PATH. */
export const ACKNOWLEDGEMENT_VERSION = "2026-09-placeholder";

/**
 * Where a researcher goes right after acknowledging the disclaimer (end of
 * account setup). S3 inserts step 3 (notification readiness) by pointing this
 * at its screen, which then continues to Today.
 */
export const AFTER_ACKNOWLEDGEMENT_PATH = ROLE_HOME.researcher;

const PRIVATE_AREA: Record<AppRole, string> = { admin: "/admin", researcher: "/app" };

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

/** The landing page for a signed-in person: their return path if it belongs to their role, else their home. */
export function destinationFor(
  person: { role: AppRole; acknowledged: boolean },
  next?: string | null,
): string {
  if (person.role === "researcher" && !person.acknowledged) return ACKNOWLEDGE_PATH;
  const safe = safeNextPath(next);
  const area = PRIVATE_AREA[person.role];
  if (safe && (safe === area || safe.startsWith(`${area}/`) || safe.startsWith(`${area}?`))) return safe;
  return ROLE_HOME[person.role];
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
