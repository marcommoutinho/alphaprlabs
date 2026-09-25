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

/** Lower-cased, trimmed email; null if it isn't a plausible address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}
