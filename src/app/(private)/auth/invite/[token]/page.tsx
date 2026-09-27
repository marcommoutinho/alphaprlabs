import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { RECOVER_PATH, SIGN_IN_PATH } from "@/lib/auth/paths";
import { formatDate } from "@/lib/format";
import { viewInvitation } from "@/lib/invitations/service";

// The token is in the URL: never leak it to other sites in a Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

/** Who invited, as the invitee sees it: never an admin's name (Marco, 2026-09-27). */
const INVITER = "An Alpha PR Labs admin";

/** C1 Invitation: valid, expired, or already used (also any unknown link). */
export default async function InvitationPage({ params }: { params: Params }) {
  await connection();
  const { token } = await params;
  const invitation = await viewInvitation(token);

  return (
    <AuthCard width={440} logo>
      {invitation.state === "valid" ? (
        <>
          <div className="app-auth-kicker">You&apos;re invited</div>
          <h1 className="app-auth-title">Join Alpha PR Labs Research</h1>
          <p className="app-auth-lead">
            {INVITER} invited <b>{invitation.email}</b>. Access is by invitation only; there is no
            public signup.
          </p>
          <Link
            href={`/auth/invite/${encodeURIComponent(token)}/setup`}
            className="app-btn app-btn--primary app-btn--block app-auth-cta"
          >
            Accept invitation
          </Link>
          <p className="app-auth-note">Invitation valid until {formatDate(invitation.expiresAt)}.</p>
        </>
      ) : invitation.state === "expired" ? (
        <>
          <h1 className="app-auth-title">This invitation has expired</h1>
          <p className="app-auth-lead">
            Invitations are valid for 30 days. Ask an Alpha PR Labs admin to send a new one to{" "}
            {invitation.email}. Nothing else is needed from you.
          </p>
        </>
      ) : (
        <>
          <h1 className="app-auth-title">This invitation was already used</h1>
          <p className="app-auth-lead">
            {invitation.email ? `An account for ${invitation.email} already exists. ` : null}
            <Link href={SIGN_IN_PATH}>Sign in</Link> instead, or <Link href={RECOVER_PATH}>recover access</Link> if
            you&apos;ve lost it.
          </p>
          <Link href={SIGN_IN_PATH} className="app-btn app-btn--primary app-btn--block app-auth-cta">
            Sign in
          </Link>
        </>
      )}
      <div className="app-auth-footer">
        <Link href={SIGN_IN_PATH}>Already have an account? Sign in</Link>
      </div>
    </AuthCard>
  );
}
