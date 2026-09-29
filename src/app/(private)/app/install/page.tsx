import { InstallScreen } from "@/components/push/install-screen";
import { requireResearcher } from "@/lib/auth/session";

/**
 * Install the app (Marco, 2026-09-29): the install guide for every signed-in
 * person (researchers and admins), from Me and the account menu. Nothing
 * here reads the person's records; the page only needs a session.
 */
export default async function InstallPage() {
  await requireResearcher("/app/install");
  return <InstallScreen />;
}
