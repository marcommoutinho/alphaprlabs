import { PeptideEditor } from "@/components/admin/library/peptide-editor";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminPeptides } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "New peptide · Alpha PR Labs" };

/** A9 / D6 Add peptide: a new entry starts as a draft (Save draft) or is published at once (needs the summary). */
export default async function NewPeptidePage() {
  await requireAdmin("/admin/library/peptides/new");
  const entries = await listAdminPeptides(await createClient());
  return <PeptideEditor entry={null} takenNames={entries.map((entry) => entry.name.trim().toLowerCase())} />;
}
