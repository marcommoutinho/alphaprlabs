import { AppPage } from "@/components/app-shell/app-shell";
import { ProgressScreen } from "@/components/research/progress-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords } from "@/lib/doses/service";
import { countCheckIns, listCheckIns } from "@/lib/progress/service";
import { progressView, progressWindow, selectedCycle } from "@/lib/progress/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/progress.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R9 Progress, for the signed-in researcher's own records only (a granted
 * admin reads other people's check-ins in A8, S17, never here). `?cycle=<id>`
 * picks the cycle whose goal, baseline, phases and zone are shown; the
 * check-in itself covers all active peptides, one per day.
 */
export default async function ProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const asked = typeof params.cycle === "string" && UUID.test(params.cycle) ? params.cycle.toLowerCase() : null;
  const person = await requireResearcher(`/app/progress${asked ? `?cycle=${asked}` : ""}`);

  const db = await createClient();
  const now = new Date();
  const [cycles, records, library, total] = await Promise.all([
    listCycles(db, person.id),
    listDoseRecords(db, person.id),
    listCyclePeptides(db),
    countCheckIns(db, person.id),
  ]);
  const cycle = selectedCycle(cycles, asked, now);
  const checkIns = cycle ? await listCheckIns(db, person.id, progressWindow(cycle, now)) : [];

  const view = progressView({
    cycles,
    selectedId: asked,
    checkIns,
    total,
    confirmations: confirmationsByCycle(records),
    peptides: new Map(library.map((peptide) => [peptide.id, peptide])),
    now,
  });

  return (
    <AppPage>
      <ProgressScreen view={view} />
    </AppPage>
  );
}
