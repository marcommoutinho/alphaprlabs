import Link from "@/components/alpha/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { SupplementsScreen } from "@/components/research/supplements-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listAvailablePeptides } from "@/lib/library/research";
import { getSupplementTracking, listRoutines, listTaken } from "@/lib/supplements/service";
import { supplementsView } from "@/lib/supplements/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/supplements.css";
import "@/styles/app/today.css";

/**
 * R10 Supplement routines, for the signed-in researcher's own routines only
 * (a granted admin reads other people's in A8, S17, never here). Shows the
 * supplement guidance admins supplied in the library (offered peptides only,
 * as library browsing does); nothing is tracked until "Track supplements" is
 * on and a routine (name, amount, unit, daily time) is created.
 */
export default async function SupplementsPage() {
  const person = await requireResearcher("/app/supplements");
  const db = await createClient();
  const [tracking, routines, taken, peptides] = await Promise.all([
    getSupplementTracking(db, person.id),
    listRoutines(db, person.id),
    listTaken(db, person.id),
    listAvailablePeptides(db),
  ]);

  const view = supplementsView({
    tracking,
    routines,
    taken,
    guidance: peptides.map((peptide) => ({ name: peptide.name, text: peptide.supplement })),
    now: new Date(),
  });

  return (
    <AppPage width="narrow">
      <Link href="/app/me" className="app-supp-back">
        ‹ Me
      </Link>
      <SupplementsScreen view={view} />
    </AppPage>
  );
}
