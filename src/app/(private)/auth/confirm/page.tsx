import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
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
    <AuthFrame>
      <AuthHeading logo title="Recover access" lead="Continue to choose a new password for your account." />
      <ConfirmRecoveryForm tokenHash={tokenHash} />
    </AuthFrame>
  );
}
