import { redirect } from "next/navigation";
import { AuthFrame, AuthHeading, AuthNotice } from "@/components/auth/auth-frame";
import { SignInForm } from "@/components/auth/sign-in-forms";
import { destinationFor, safeNextPath } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

type SearchParams = Promise<{ expired?: string | string[]; next?: string | string[] }>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Sign in (design v3). `?expired=1` when a protected page found a lapsed session. */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(one(params.next)) ?? undefined;

  const person = await getSessionPerson();
  if (person) redirect(destinationFor(person, next));

  return (
    <AuthFrame>
      <AuthHeading logo kicker="Alpha Research" title="Sign in" lead="Access is by invitation. Use the email your invitation was sent to." />
      {one(params.expired) === "1" ? <AuthNotice>Your session expired. Sign in again to continue.</AuthNotice> : null}
      <SignInForm next={next} />
    </AuthFrame>
  );
}
