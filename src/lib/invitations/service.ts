import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeSendError, sendInvitationEmail, type SmtpSettings } from "./email";
import { displayState, normalizeEmail, type InvitationDisplayState } from "./state";

type Db = SupabaseClient<Database>;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_NAME_LENGTH = 120;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes (base64url) for the link; only its SHA-256 is stored. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SendContext = {
  /** e.g. https://app.alphaprlabs.com — the link is `${origin}/auth/invite/<token>`. */
  origin: string;
  inviterName: string;
  smtp?: SmtpSettings;
};

// ── Admin side. `db` is the admin's own session client: RLS and the SQL
// functions' is_admin() checks apply on top of the caller's role check. ──────

export type InvitationRow = {
  id: string;
  name: string;
  email: string;
  sentAt: string;
  state: InvitationDisplayState;
};

export async function listInvitations(db: Db, now = new Date()): Promise<InvitationRow[]> {
  const { data, error } = await db
    .from("invitations")
    .select("id, name, email, state, sent_at, expires_at")
    // Newest first by the displayed "Sent" date (resend and re-invite move it).
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`Could not load invitations: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    sentAt: row.sent_at,
    state: displayState(row, now),
  }));
}

export type InviteResult =
  | { kind: "sent" | "send_failed" | "account_exists" | "pending_exists"; email: string }
  | { kind: "invalid_email" | "invalid_name" | "error" };

async function deliver(db: Db, id: string, to: string, name: string, token: string, ctx: SendContext) {
  try {
    await sendInvitationEmail(
      { to, name: name || to, inviterName: ctx.inviterName, link: `${ctx.origin}/auth/invite/${token}` },
      ctx.smtp,
    );
    return "sent" as const;
  } catch (error) {
    await db.rpc("mark_invitation_send_failed", { p_id: id, p_error: describeSendError(error) });
    return "send_failed" as const;
  }
}

export async function inviteResearcher(
  db: Db,
  input: { name: unknown; email: unknown },
  ctx: SendContext,
): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { kind: "invalid_email" };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length > MAX_NAME_LENGTH) return { kind: "invalid_name" };

  const { token, hash } = newInvitationToken();
  const { data, error } = await db.rpc("invite_researcher", { p_name: name, p_email: email, p_token_hash: hash });
  const result = data?.[0];
  if (error || !result) return { kind: "error" };
  if (result.outcome === "account_exists" || result.outcome === "pending_exists") {
    return { kind: result.outcome, email };
  }
  return { kind: await deliver(db, result.invitation_id, email, name, token, ctx), email };
}

export type ResendResult = { kind: "sent" | "send_failed"; email: string } | { kind: "not_resendable" | "error" };

/** Fresh token, sent now, valid 30 more days. Only expired or failed rows. */
export async function resendInvitation(db: Db, id: unknown, ctx: SendContext): Promise<ResendResult> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { kind: "not_resendable" };
  const { token, hash } = newInvitationToken();
  const { data, error } = await db.rpc("resend_invitation", { p_id: id, p_token_hash: hash });
  if (error) return { kind: "error" };
  const row = data?.[0];
  if (!row) return { kind: "not_resendable" };
  return { kind: await deliver(db, id, row.email, row.name, token, ctx), email: row.email };
}

// ── Invitee side (no session yet): secret-key client, token lookups only. ────

/**
 * What the invitee's screens show. Never the inviting admin's name: a
 * researcher never learns which admin it is (Marco, 2026-09-27).
 */
export type InvitationView =
  | { state: "valid"; name: string; email: string; expiresAt: string }
  | { state: "expired"; email: string }
  /** Accepted, an account already exists, or an unknown token (email null). */
  | { state: "used"; email: string | null };

export async function viewInvitation(token: string, now = new Date()): Promise<InvitationView> {
  if (!TOKEN_PATTERN.test(token)) return { state: "used", email: null };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("invitations")
    .select("name, email, state, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!row) return { state: "used", email: null };
  if (row.state === "accepted") return { state: "used", email: row.email };

  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("email", row.email);
  if (count) return { state: "used", email: row.email };

  if (displayState({ state: "pending", expires_at: row.expires_at }, now) === "expired") {
    return { state: "expired", email: row.email };
  }
  return { state: "valid", name: row.name, email: row.email, expiresAt: row.expires_at };
}

export type AcceptResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_name" | "weak_password" | "invalid" | "error" };

/**
 * Accepts an invitation: claims it (single use, so a double submit gets
 * `invalid`), creates the confirmed Auth account and the researcher profile.
 * Rolls the claim back if the account cannot be created. Does not sign in.
 */
export async function acceptInvitation(input: { token: string; name: string; password: string }): Promise<AcceptResult> {
  const name = input.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: "invalid_name" };
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak_password" };
  if (!TOKEN_PATTERN.test(input.token)) return { ok: false, reason: "invalid" };

  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_invitation", {
    p_token_hash: hashToken(input.token),
  });
  if (claimError) return { ok: false, reason: "error" };
  const invitation = claimed?.[0];
  if (!invitation) return { ok: false, reason: "invalid" };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password: input.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    await admin.rpc("release_invitation", { p_id: invitation.id });
    if (createError?.code === "email_exists") return { ok: false, reason: "invalid" };
    if (createError?.code === "weak_password") return { ok: false, reason: "weak_password" };
    return { ok: false, reason: "error" };
  }

  const { error: completeError } = await admin.rpc("complete_invitation", {
    p_id: invitation.id,
    p_user_id: created.user.id,
    p_name: name,
  });
  if (completeError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.rpc("release_invitation", { p_id: invitation.id });
    return { ok: false, reason: "error" };
  }
  return { ok: true, email: invitation.email };
}
