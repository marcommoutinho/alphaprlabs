import { notFound } from "next/navigation";
import { PeptideEditor } from "@/components/admin/library/peptide-editor";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminPeptides } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Edit peptide · Alpha PR Labs" };

type Params = Promise<{ peptideId: string }>;

/**
 * A9 / D6 Edit peptide. The editor is keyed by the entry's version: after a
 * save (or "Load latest" when another admin saved first) it reopens on what
 * is stored now.
 */
export default async function PeptideEditorPage({ params }: { params: Params }) {
  const { peptideId } = await params;
  await requireAdmin(`/admin/library/peptides/${encodeURIComponent(peptideId)}`);
  const entries = await listAdminPeptides(await createClient());
  const entry = entries.find((item) => item.id === peptideId.toLowerCase());
  if (!entry) notFound();
  const taken = entries.filter((item) => item.id !== entry.id).map((item) => item.name.trim().toLowerCase());
  return <PeptideEditor key={`${entry.id}:${entry.version}`} entry={entry} takenNames={taken} />;
}
