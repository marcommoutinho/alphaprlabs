import { AppPage } from "@/components/app-shell/app-shell";
import { InvitationsView } from "@/components/admin/invitations-view";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { canResend, STATE_LABEL } from "@/lib/invitations/state";
import { listInvitations } from "@/lib/invitations/service";
import { createClient } from "@/lib/supabase/server";

/** A1 Researcher invitations (admins only; RLS also limits the list to admins). */
export default async function InvitationsPage() {
  await requireAdmin("/admin/invitations");
  const invitations = await listInvitations(await createClient());

  return (
    <AppPage>
      <h1 className="app-h1">Researcher invitations</h1>
      <p className="app-subtitle">
        The only way to join. An invitation creates a researcher account once accepted (with the back office too
        when you choose Admin); it gives you no access to that person&apos;s private history.
      </p>
      <InvitationsView
        rows={invitations.map((row) => ({
          id: row.id,
          name: row.name || "—",
          email: row.email,
          sent: formatDate(row.sentAt),
          state: row.state,
          label: STATE_LABEL[row.state],
          canResend: canResend(row.state),
          role: row.role,
        }))}
      />
    </AppPage>
  );
}
