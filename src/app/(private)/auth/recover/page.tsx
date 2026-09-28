import { AuthFrame, AuthHeading, AuthNotice } from "@/components/auth/auth-frame";
import { RecoverForm } from "@/components/auth/sign-in-forms";

type SearchParams = Promise<{ link?: string | string[] }>;

/** Recover access (design v3). The confirmation never reveals whether the email has an account. */
export default async function RecoverPage({ searchParams }: { searchParams: SearchParams }) {
  const { link } = await searchParams;
  return (
    <AuthFrame>
      <AuthHeading logo title="Recover access" lead="We'll email a sign-in link if this address belongs to an invited researcher." />
      {link === "invalid" ? <AuthNotice>That link has expired or was already used. Send a new one below.</AuthNotice> : null}
      <RecoverForm />
    </AuthFrame>
  );
}
