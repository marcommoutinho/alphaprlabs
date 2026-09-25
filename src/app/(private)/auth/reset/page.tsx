import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { NewPasswordForm } from "@/components/auth/sign-in-forms";
import { RECOVER_PATH } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/**
 * Set a new password after following the recovery link (/auth/confirm signed
 * the person in). Not in the prototype; built from the C1 patterns.
 */
export default async function ResetPasswordPage() {
  const person = await getSessionPerson();
  if (!person) redirect(`${RECOVER_PATH}?link=invalid`);

  return (
    <AuthCard>
      <h1 className="app-auth-title">Set a new password</h1>
      <p className="app-auth-lead">
        For <b>{person.email}</b>. You&apos;ll stay signed in on this device.
      </p>
      <NewPasswordForm />
    </AuthCard>
  );
}
