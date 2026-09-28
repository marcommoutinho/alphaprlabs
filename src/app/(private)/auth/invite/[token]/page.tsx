import type { Metadata } from "next";
import { connection } from "next/server";
import { buttonVariants } from "@/components/alpha/button-variants";
import Link from "@/components/alpha/link";
import { AuthActions, AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { AccountSetupForm } from "@/components/auth/invite-forms";
import { RECOVER_PATH, SIGN_IN_PATH } from "@/lib/auth/paths";
import { formatMonthDay } from "@/lib/format";
import { viewInvitation } from "@/lib/invitations/service";
import { cn } from "@/lib/utils";

// The token is in the URL: never leak it to other sites in a Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

/** Invitation dates are shown in the business zone. */
const INVITATION_TIME_ZONE = "America/Toronto";

const INVITE_LEAD = "A private app for the researchers Alpha PR Labs works with. Your records are yours; admins see them only if you allow it.";

/**
 * R14 Accept invitation (step 1 of 3): the invitation's name and email and a
 * password, straight from the emailed link. Anonymous: never an admin's name
 * (Marco, 2026-09-27). Expired and already used (also any unknown link)
 * explain themselves instead.
 */
export default async function InvitationPage({ params }: { params: Params }) {
  await connection();
  const { token } = await params;
  const invitation = await viewInvitation(token);

  if (invitation.state === "valid") {
    return (
      <AuthFrame step={1}>
        <AuthHeading logo kicker="You've been invited" title="Join Alpha Research" lead={INVITE_LEAD} />
        <AccountSetupForm
          token={token}
          name={invitation.name}
          email={invitation.email}
          validUntil={formatMonthDay(invitation.expiresAt, { timeZone: INVITATION_TIME_ZONE })}
          note={
            invitation.role === "admin"
              ? "An Alpha PR Labs admin invited you with admin access. Accepting creates a researcher account with admin access."
              : "An Alpha PR Labs admin invited you. Accepting creates a researcher account; roles are assigned by admins."
          }
        />
      </AuthFrame>
    );
  }

  if (invitation.state === "expired") {
    return (
      <AuthFrame>
        <AuthHeading
          logo
          title="This invitation has expired"
          lead={`Invitations are valid for 30 days. Ask an Alpha PR Labs admin to send a new one to ${invitation.email}. Nothing else is needed from you.`}
        />
        <AuthActions>
          <Link href={SIGN_IN_PATH} className={cn(buttonVariants({ variant: "outline", size: "lg", block: true }))}>
            Already have an account? Sign in
          </Link>
        </AuthActions>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthHeading
        logo
        title="This invitation was already used"
        lead={
          <>
            {invitation.email ? `An account for ${invitation.email} already exists. ` : null}
            <Link href={SIGN_IN_PATH} className="font-semibold text-signal-ink">
              Sign in
            </Link>{" "}
            instead, or{" "}
            <Link href={RECOVER_PATH} className="font-semibold text-signal-ink">
              recover access
            </Link>{" "}
            if you&apos;ve lost it.
          </>
        }
      />
      <AuthActions>
        <Link href={SIGN_IN_PATH} className={cn(buttonVariants({ variant: "ink", size: "lg", block: true }))}>
          Sign in
        </Link>
      </AuthActions>
    </AuthFrame>
  );
}
