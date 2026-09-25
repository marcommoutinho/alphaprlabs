import { AuthCard } from "@/components/auth/auth-card";
import { RecoverForm } from "@/components/auth/sign-in-forms";

type SearchParams = Promise<{ link?: string | string[] }>;

/** C1 Recover access. The confirmation never reveals whether the email has an account. */
export default async function RecoverPage({ searchParams }: { searchParams: SearchParams }) {
  const { link } = await searchParams;
  return (
    <AuthCard>
      <h1 className="app-auth-title">Recover access</h1>
      <p className="app-auth-lead">We&apos;ll email a sign-in link if this address belongs to an invited researcher.</p>
      {link === "invalid" ? (
        <p className="app-auth-notice" role="status">
          That link has expired or was already used. Send a new one below.
        </p>
      ) : null}
      <RecoverForm />
    </AuthCard>
  );
}
