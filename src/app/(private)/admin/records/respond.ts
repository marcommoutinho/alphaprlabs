import { currentAdmin, type SessionPerson } from "@/lib/auth/session";

// The record sheets' and the Ledger's reads (GET Route Handlers, so a live
// preview never waits behind a Server Action: Next runs those one at a time).
// Admins only (checked here and again by every database read), never cached.

export const noStore = { "Cache-Control": "private, no-store" } as const;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** The signed-in admin, or the 403 answer. */
export async function adminOr403(): Promise<{ admin: SessionPerson } | { denied: Response }> {
  const admin = await currentAdmin();
  return admin ? { admin } : { denied: json({ error: "Only admins can do this." }, 403) };
}
