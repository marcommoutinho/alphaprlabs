import { notFound, redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { InstallStep } from "@/components/auth/install-step";
import { hasResearchAccess } from "@/lib/app/identity";
import { ACKNOWLEDGE_PATH, signInUrl } from "@/lib/auth/paths";
import { getSessionPerson } from "@/lib/auth/session";

/**
 * R16 Put Alpha on your Home Screen (step 3 of 3), right after R15. The page
 * decides in the browser: the install guide for this phone and browser (a
 * laptop gets the QR code); already in the installed app, it goes on to
 * Today.
 */
export default async function InstallPage() {
  const person = await getSessionPerson();
  if (!person) redirect(signInUrl());
  if (!hasResearchAccess(person.role)) notFound();
  if (!person.acknowledged) redirect(ACKNOWLEDGE_PATH);

  return (
    <AuthFrame step={3}>
      <InstallStep />
    </AuthFrame>
  );
}
