import { PeopleScreen } from "@/components/admin/people/people-screen";
import { requireAdmin } from "@/lib/auth/session";
import { listInvitations } from "@/lib/invitations/service";
import { listPeople } from "@/lib/people/service";
import { peopleView } from "@/lib/people/view";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "People · Alpha PR Labs" };

/**
 * A11 / D8 People (admins only; admin_people() and the invitations' RLS
 * check in the database too): names, emails, share state and the open
 * invitations. The old /admin/invitations and /admin/support addresses
 * redirect here.
 */
export default async function PeoplePage() {
  const admin = await requireAdmin("/admin/people");
  const db = await createClient();
  const [accounts, invitations] = await Promise.all([listPeople(db), listInvitations(db)]);
  return <PeopleScreen view={peopleView(accounts, invitations, admin.id)} />;
}
