import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { AccountSetupForm } from "@/components/auth/invite-forms";
import { viewInvitation } from "@/lib/invitations/service";

export const metadata: Metadata = { referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

/** C1 step 1 of 3: set up access from a valid invitation. */
export default async function AccountSetupPage({ params }: { params: Params }) {
  await connection();
  const { token } = await params;
  const invitation = await viewInvitation(token);
  if (invitation.state !== "valid") redirect(`/auth/invite/${encodeURIComponent(token)}`);

  return (
    <AuthCard width={440}>
      <div className="app-auth-step">Step 1 of 3</div>
      <h1 className="app-auth-title">Set up your access</h1>
      <AccountSetupForm token={token} name={invitation.name} email={invitation.email} />
      <p className="app-auth-note">
        Roles are assigned by admins. Accepting an invitation creates a researcher account only.
      </p>
    </AuthCard>
  );
}
