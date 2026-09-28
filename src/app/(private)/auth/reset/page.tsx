import { redirect } from "next/navigation";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { NewPasswordForm } from "@/components/auth/sign-in-forms";
import { RECOVER_PATH } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/**
 * Set a new password after following the recovery link (/auth/confirm signed
 * the person in). Design v3, in the sign-in style.
 */
export default async function ResetPasswordPage() {
  const person = await getSessionPerson();
  if (!person) redirect(`${RECOVER_PATH}?link=invalid`);

  return (
    <AuthFrame>
      <AuthHeading
        logo
        title="Set a new password"
        lead={
          <>
            For <b className="font-mono text-[14px] font-medium break-all text-ink">{person.email}</b>. You&apos;ll stay signed in on this device.
          </>
        }
      />
      <NewPasswordForm />
    </AuthFrame>
  );
}
