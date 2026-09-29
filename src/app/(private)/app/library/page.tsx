import { RefreshOnRestore } from "@/components/alpha/restored";
import { LibraryScreen } from "@/components/research/library/library-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { listAvailablePeptides } from "@/lib/library/research";
import { libraryMeta, libraryRows, peptidesInCycles } from "@/lib/library/screen";
import { createClient } from "@/lib/supabase/server";

/**
 * R11 Library (design v3): the peptides still offered (entries marked "Not
 * offered" never appear here; Marco, 2026-09-26), each tagged when one of
 * the caller's own current cycles uses it. Supplied templates are browsed
 * from Cycles (R10 "Browse templates"). Loading and error: ./loading.tsx,
 * ./error.tsx. Back or forward to it asks the server again (RefreshOnRestore):
 * the list shown before may show for a moment.
 */
export default async function LibraryPage() {
  const person = await requireResearcher("/app/library");
  const db = await createClient();
  const [peptides, cycles] = await Promise.all([listAvailablePeptides(db), listCycles(db, person.id)]);
  const rows = libraryRows(peptides, peptidesInCycles(cycles, new Date()));
  return (
    <>
      <RefreshOnRestore id={crypto.randomUUID()} />
      <LibraryScreen meta={libraryMeta(peptides)} rows={rows} />
    </>
  );
}
