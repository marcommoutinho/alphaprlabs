import { notFound, redirect } from "next/navigation";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { AcknowledgementForm } from "@/components/auth/invite-forms";
import { hasResearchAccess } from "@/lib/app/identity";
import { RESEARCH_HOME, signInUrl } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/**
 * R15 For research use only (step 2 of 3). Researchers and admins (every
 * admin is also a researcher) are routed here from the research side until
 * they agree; the agreement is stored with its time and
 * ACKNOWLEDGEMENT_VERSION. Reopened read-only from Me (/app/me/disclaimer).
 */
export default async function AcknowledgePage() {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl());
  if (!hasResearchAccess(person.role)) notFound();
  if (person.acknowledged) redirect(RESEARCH_HOME);

  return (
    <AuthFrame step={2}>
      <AuthHeading title="For research use only" lead="Please read this once. It's recorded with your account." />
      <AcknowledgementForm />
    </AuthFrame>
  );
}
