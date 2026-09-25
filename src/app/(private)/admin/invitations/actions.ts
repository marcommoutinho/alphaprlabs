"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { appOrigin } from "@/lib/auth/origin";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { inviteResearcher, resendInvitation } from "@/lib/invitations/service";
import { createClient } from "@/lib/supabase/server";

export type InviteActionResult = {
  /** Inline validation error under the form. */
  error?: string;
  /** Toast to show, with its tone. */
  toast?: string;
  tone?: "info" | "error";
  /** The invitation was sent: clear the form. */
  sent?: boolean;
};

const SAVE_FAILED = "Could not save. Nothing was lost — your entry is still here. Try again.";

/** Every call re-checks that the requester is a signed-in admin. */
async function requireAdminForAction() {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/invitations" }));
  return admin;
}

export async function sendInvitation(input: { name: unknown; email: unknown }): Promise<InviteActionResult> {
  const admin = await requireAdminForAction();
  const db = await createClient();
  const result = await inviteResearcher(db, input, { origin: await appOrigin(), inviterName: admin.name });

  switch (result.kind) {
    case "invalid_email":
      return { error: "Enter a valid email address." };
    case "invalid_name":
      return { error: "Names can be up to 120 characters." };
    case "account_exists":
      return { error: `${result.email} already has an account. They can sign in or recover access.` };
    case "pending_exists":
      return { error: `${result.email} already has a pending invitation.` };
    case "sent":
      refresh();
      return { sent: true, toast: `Invitation sent to ${result.email}`, tone: "info" };
    case "send_failed":
      refresh();
      return { toast: "Invitation could not be sent. It's listed as failed so you can resend it.", tone: "error" };
    default:
      return { toast: SAVE_FAILED, tone: "error" };
  }
}

export async function resendInvitationAction(id: unknown): Promise<InviteActionResult> {
  const admin = await requireAdminForAction();
  const db = await createClient();
  const result = await resendInvitation(db, id, { origin: await appOrigin(), inviterName: admin.name });
  refresh();

  switch (result.kind) {
    case "sent":
      return { toast: `Invitation resent to ${result.email}`, tone: "info" };
    case "send_failed":
      return {
        toast: `Could not send to ${result.email}. The invitation is still listed — try again.`,
        tone: "error",
      };
    case "not_resendable":
      return { toast: "This invitation can't be resent. The list has been refreshed.", tone: "error" };
    default:
      return { toast: SAVE_FAILED, tone: "error" };
  }
}
