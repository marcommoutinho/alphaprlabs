// Invitation display rules (A1, C1). Pure: shared by server code and tests.

export const INVITATION_VALID_DAYS = 30;

export type StoredInvitationState = "pending" | "accepted" | "failed";
export type InvitationDisplayState = "pending" | "accepted" | "expired" | "failed";

/** A pending invitation past `expires_at` shows (and behaves) as Expired. */
export function displayState(
  row: { state: StoredInvitationState; expires_at: string },
  now: Date = new Date(),
): InvitationDisplayState {
  if (row.state === "pending" && new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return row.state;
}

export const STATE_LABEL: Record<InvitationDisplayState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  failed: "Send failed",
};

/** Expired and failed rows can be resent. */
export const canResend = (state: InvitationDisplayState) => state === "expired" || state === "failed";

// ── Roles (Marco, 2026-09-27: admins can invite a new admin) ────────────────
export type InvitationRole = "researcher" | "admin";

/** The role an invitation asks for: researcher unless exactly "admin" (missing = researcher); null if unknown. */
export function invitationRole(value: unknown): InvitationRole | null {
  if (value === undefined || value === "researcher") return "researcher";
  return value === "admin" ? "admin" : null;
}

export const ROLE_LABEL: Record<InvitationRole, string> = { researcher: "Researcher", admin: "Admin" };

/** A1 confirm step before sending an admin invitation. */
export const ADMIN_CONFIRM_TITLE = "Give this person admin access?";
export const ADMIN_CONFIRM_POINTS = [
  "They'll see all business records: stock, purchases, sales, costs and gross profit, and can record them.",
  "They can maintain the library and templates and invite researchers and other admins.",
  "They see a researcher's history only while that researcher shares it with the team, like every admin.",
] as const;
export const ADMIN_CONFIRM_SUBMIT = "Send admin invitation";
export const INVALID_ROLE = "Choose Researcher or Admin.";

/** Lower-cased, trimmed email; null if it isn't a plausible address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}
