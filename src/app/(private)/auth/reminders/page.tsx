import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { RemindersStep } from "@/components/push/reminders-panel";
import { ACKNOWLEDGE_PATH, ROLE_HOME, signInUrl } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/**
 * C2 step 3 of 3 (optional): reminders on this phone. Reached right after the
 * acknowledgement, and once on the first open of the installed iPhone app.
 */
export default async function RemindersReadinessPage() {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl());
  if (person.role !== "researcher") redirect(ROLE_HOME[person.role]);
  if (!person.acknowledged) redirect(ACKNOWLEDGE_PATH);

  return (
    <AuthCard width={480}>
      <RemindersStep userId={person.id} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
    </AuthCard>
  );
}
