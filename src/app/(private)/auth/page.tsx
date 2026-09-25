import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-forms";
import { destinationFor, safeNextPath } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

type SearchParams = Promise<{ expired?: string | string[]; next?: string | string[] }>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** C1 Sign in. `?expired=1` when a protected page found a lapsed session. */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(one(params.next)) ?? undefined;

  const person = await getSessionPerson();
  if (person) redirect(destinationFor(person, next));

  return (
    <AuthCard logo>
      <h1 className="app-auth-title">Sign in</h1>
      {one(params.expired) === "1" ? (
        <p className="app-auth-notice" role="status">
          Your session expired. Sign in again to continue.
        </p>
      ) : null}
      <SignInForm next={next} />
    </AuthCard>
  );
}
