import { LibraryHeader } from "@/components/admin/library/library-header";
import { PeptideList } from "@/components/admin/library/peptide-list";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminPeptides } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";
import { countTemplates } from "@/lib/templates/service";

/**
 * A8 / D6 Library · Peptides (admins only; every read checks is_admin() in
 * the database too). The list stays put while an entry is edited: on a
 * laptop it is D6's 360 px column beside the editor; on a phone the editor
 * (A9) opens full screen over it. Drafts and entries no longer offered are
 * listed here only; researchers never see a draft.
 */
export default async function PeptidesLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin("/admin/library");
  const db = await createClient();
  const [entries, templates] = await Promise.all([listAdminPeptides(db), countTemplates(db)]);
  return (
    <div
      className="flex w-full flex-1 flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:grid laptop:grid-cols-[360px_minmax(0,1fr)] laptop:items-start laptop:pb-0"
      data-testid="library"
    >
      <section aria-label="Peptide list" className="flex flex-col laptop:min-h-dvh laptop:border-r laptop:border-line laptop:pb-10">
        <LibraryHeader tab="peptides" counts={{ peptides: entries.length, templates }} pane />
        <PeptideList entries={entries} />
      </section>
      {children}
    </div>
  );
}
