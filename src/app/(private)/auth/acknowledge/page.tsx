import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { AcknowledgementForm } from "@/components/auth/invite-forms";
import { AFTER_ACKNOWLEDGEMENT_PATH, ROLE_HOME, signInUrl } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/** C1 step 2 of 3. Researchers are routed here until they acknowledge. */
export default async function AcknowledgePage() {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl());
  if (person.role !== "researcher") redirect(ROLE_HOME[person.role]);
  if (person.acknowledged) redirect(AFTER_ACKNOWLEDGEMENT_PATH);

  return (
    <AuthCard width={520}>
      <div className="app-auth-step">Step 2 of 3</div>
      <h1 className="app-auth-title">Researcher acknowledgement</h1>
      <div className="app-auth-disclaimer">
        <div className="app-auth-disclaimer-tag">CONTENT PLACEHOLDER · FINAL WORDING TO BE SUPPLIED BY MARCO</div>
        [Researcher disclaimer text. States that the account holder is a researcher, that peptide information,
        templates and guidance in this app are supplied content and not recommendations, and that the researcher
        is responsible for their own plans and records.]
      </div>
      <AcknowledgementForm />
      <p className="app-auth-note">Required to use the app. Recorded with your account.</p>
    </AuthCard>
  );
}
