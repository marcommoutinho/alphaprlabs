import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { SuppliesScreen } from "@/components/research/supplies-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords, listDoseSkips } from "@/lib/doses/service";
import { getSupplyTracking, listMixtures, listPersonalVials } from "@/lib/mixtures/service";
import { listDeductions } from "@/lib/supplies/service";
import { suppliesView } from "@/lib/supplies/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/supplies.css";

/**
 * R8 Personal supplies, for the signed-in researcher's own vials only (a
 * granted admin reads other people's supplies in A8, S17, never here).
 * Optional: "Track supplies" turns it on. Each vial's estimated remaining is
 * its strength minus the confirmed doses deducted from it; low stock is
 * judged against the next planned dose of the plans using its mixture.
 */
export default async function SuppliesPage() {
  const person = await requireResearcher("/app/supplies");
  const db = await createClient();
  const [tracking, vials, mixtures, library, deductions, records, cycles, skips] = await Promise.all([
    getSupplyTracking(db, person.id),
    listPersonalVials(db, person.id),
    listMixtures(db, person.id),
    listCyclePeptides(db),
    listDeductions(db, person.id),
    listDoseRecords(db, person.id),
    listCycles(db, person.id),
    listDoseSkips(db, person.id),
  ]);

  const view = suppliesView({
    tracking,
    vials,
    mixtures,
    peptides: new Map(library.map((peptide) => [peptide.id, peptide])),
    deductions,
    doses: records,
    cycles,
    confirmations: confirmationsByCycle(records, skips),
    now: new Date(),
  });

  return (
    <AppPage width="narrow">
      <Link href="/app/me" className="app-sup-back">
        ‹ Me
      </Link>
      <SuppliesScreen view={view} />
    </AppPage>
  );
}
