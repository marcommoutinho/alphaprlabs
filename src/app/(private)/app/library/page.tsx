import { RestoreGate } from "@/components/alpha/restored";
import { LibraryScreen } from "@/components/research/library/library-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { listAvailablePeptides } from "@/lib/library/research";
import { libraryMeta, libraryRows, peptidesInCycles } from "@/lib/library/screen";
import { createClient } from "@/lib/supabase/server";
import LibraryLoading from "./loading";

/**
 * R11 Library (design v3): the peptides still offered (entries marked "Not
 * offered" never appear here; Marco, 2026-09-26), each tagged when one of
 * the caller's own current cycles uses it. Supplied templates are browsed
 * from Cycles (R10 "Browse templates"). Loading and error: ./loading.tsx,
 * ./error.tsx. Put back by back or forward, it shows the loading placeholders
 * while the server is asked again (RestoreGate), never the list from before.
 */
export default async function LibraryPage() {
  const person = await requireResearcher("/app/library");
  const db = await createClient();
  const [peptides, cycles] = await Promise.all([listAvailablePeptides(db), listCycles(db, person.id)]);
  const rows = libraryRows(peptides, peptidesInCycles(cycles, new Date()));
  return (
    <RestoreGate id={crypto.randomUUID()} placeholder={<LibraryLoading />}>
      <LibraryScreen meta={libraryMeta(peptides)} rows={rows} />
    </RestoreGate>
  );
}
