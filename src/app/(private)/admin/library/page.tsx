import { AppPage } from "@/components/app-shell/app-shell";
import { LibraryView } from "@/components/admin/library-view";
import { requireAdmin } from "@/lib/auth/session";
import { listLibrary } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

/** A2 Peptide library (admins only; RLS and the database functions also check). */
export default async function LibraryPage() {
  await requireAdmin("/admin/library");
  const entries = await listLibrary(await createClient());
  return (
    <AppPage>
      <LibraryView entries={entries} />
    </AppPage>
  );
}
