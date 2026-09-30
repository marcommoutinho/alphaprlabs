import { notFound, redirect } from "next/navigation";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { AcknowledgementForm } from "@/components/auth/invite-forms";
import { hasResearchAccess } from "@/lib/app/identity";
import { RESEARCH_HOME, signInUrl, termsAgreement } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";
import { TERMS_HEADING, TERMS_LEAD, TERMS_UPDATED_LEAD } from "@/lib/auth/terms";

/**
 * R15 Research terms. Joining, it is step 2 of 3 and goes on to R16.
 * Someone who agreed to an earlier version of the terms is routed here from
 * the research side until they agree again: the terms with the updated lead
 * and no joining steps, then Today. Researchers and admins (every admin is
 * also a researcher); the agreement is stored with its time and
 * ACKNOWLEDGEMENT_VERSION. Reopened read-only from Me (/app/me/disclaimer).
 */
export default async function AcknowledgePage() {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl());
  if (!hasResearchAccess(person.role)) notFound();
  const agreement = termsAgreement(person.agreedVersion);
  if (agreement === "current") redirect(RESEARCH_HOME);
  const joining = agreement === "none";

  return (
    <AuthFrame step={joining ? 2 : undefined}>
      <AuthHeading title={TERMS_HEADING} lead={joining ? TERMS_LEAD : TERMS_UPDATED_LEAD} />
      <AcknowledgementForm />
    </AuthFrame>
  );
}
