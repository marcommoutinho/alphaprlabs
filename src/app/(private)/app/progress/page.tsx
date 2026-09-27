import { AppPage } from "@/components/app-shell/app-shell";
import { ProgressScreen } from "@/components/research/progress-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords } from "@/lib/doses/service";
import { countCheckIns, listCheckIns } from "@/lib/progress/service";
import { NO_CYCLE_PARAM, progressView, progressWindow, selectedCycle } from "@/lib/progress/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/progress.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R9 Progress, for the signed-in researcher's own records only (a granted
 * admin reads other people's check-ins in A8, S17, never here). The check-in
 * covers all active peptides, one per Toronto day, and needs no cycle.
 * `?cycle=<id>` shows a cycle's goal, baseline and phases beside the doses;
 * `?cycle=none` shows check-ins only (the default between cycles).
 */
export default async function ProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = typeof params.cycle === "string" ? params.cycle.toLowerCase() : null;
  const asked = raw === NO_CYCLE_PARAM || (raw && UUID.test(raw)) ? raw : null;
  const person = await requireResearcher(`/app/progress${asked ? `?cycle=${asked}` : ""}`);

  const db = await createClient();
  const now = new Date();
  const [cycles, library, total, checkIns] = await Promise.all([
    listCycles(db, person.id),
    listCyclePeptides(db),
    countCheckIns(db, person.id),
    listCheckIns(db, person.id, progressWindow(now)),
  ]);
  // Doses are shown only beside a cycle.
  const records = selectedCycle(cycles, asked, now) ? await listDoseRecords(db, person.id) : [];

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
