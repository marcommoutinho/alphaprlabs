import { AppPage } from "@/components/app-shell/app-shell";
import { TodayScreen } from "@/components/research/today-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords } from "@/lib/doses/service";
import { todayView } from "@/lib/doses/today";
import { getSupplyTracking, listPersonalVials, planMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/today.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9-]{1,10}$/i;

/**
 * R1 Today, for the signed-in researcher's own cycles only (a granted admin
 * reads other people's history in A8, never here). `?dose=<occurrence key>`
 * is where a reminder tap lands (public/sw.js opens the payload's url): the
 * dose's sheet opens with its current details, or a note says it changed.
 */
export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dose = typeof params.dose === "string" && KEY.test(params.dose) ? params.dose.toLowerCase() : null;
  const person = await requireResearcher(`/app/today${dose ? `?dose=${encodeURIComponent(dose)}` : ""}`);

  const db = await createClient();
  const [cycles, records, library, mixtures, tracking, vials] = await Promise.all([
    listCycles(db, person.id),
    listDoseRecords(db, person.id),
    listCyclePeptides(db),
    planMixtures(db, person.id),
    getSupplyTracking(db, person.id),
    listPersonalVials(db, person.id),
  ]);
  const openVials = new Map<string, string>();
  if (tracking) for (const vial of vials) if (vial.mixtureId && !vial.finishedAt) openVials.set(vial.mixtureId, vial.label);

  const view = todayView({
    cycles,
    confirmations: confirmationsByCycle(records),
    recordedAt: new Map(records.map((record) => [record.occurrenceKey, record.recordedAt])),
    peptides: new Map(library.map((peptide) => [peptide.id, peptide])),
    mixtures,
    vials: openVials,
    now: new Date(),
    requestedKey: dose,
  });

  return (
    <AppPage>
      <TodayScreen key={dose ?? ""} view={view} />
    </AppPage>
  );
}
