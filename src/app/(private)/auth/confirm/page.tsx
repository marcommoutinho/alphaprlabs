import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { ConfirmRecoveryForm } from "@/components/auth/sign-in-forms";
import { RECOVER_PATH } from "@/lib/auth/paths";

// The token hash is in the URL: never leak it in a Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

type SearchParams = Promise<{ token_hash?: string | string[]; type?: string | string[] }>;

/**
 * Landing for the recovery email link (supabase/templates/recovery.html).
 * Viewing it changes nothing: email scanners that follow links would
 * otherwise use up the single-use token. The button verifies it.
 */
export default async function ConfirmRecoveryPage({ searchParams }: { searchParams: SearchParams }) {
  const { token_hash: tokenHash, type } = await searchParams;
  if (typeof tokenHash !== "string" || !tokenHash || type !== "recovery") redirect(`${RECOVER_PATH}?link=invalid`);

  return (
    <AuthCard>
      <h1 className="app-auth-title">Recover access</h1>
      <p className="app-auth-lead">Continue to choose a new password for your account.</p>
      <ConfirmRecoveryForm tokenHash={tokenHash} />
    </AuthCard>
  );
}
