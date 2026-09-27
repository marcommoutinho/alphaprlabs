import { AppPage } from "@/components/app-shell/app-shell";
import { TodayScreen } from "@/components/research/today-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords, planSetups } from "@/lib/doses/service";
import { todayView } from "@/lib/doses/today";
import { getSupplyTracking, listPersonalVials, planMixtures } from "@/lib/mixtures/service";
import { addDaysToDate } from "@/lib/doses/rules";
import { SUPPLEMENT_TIME_ZONE } from "@/lib/supplements/rules";
import { todayIn } from "@/lib/supplements/schedule";
import { getSupplementTracking, listRoutines, listTaken } from "@/lib/supplements/service";
import { supplementsToday } from "@/lib/supplements/view";
import { deductionsOfVials } from "@/lib/supplies/service";
import { todayStockNotes } from "@/lib/supplies/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/today.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9-]{1,10}$/i;

/**
 * R1 Today, for the signed-in researcher's own cycles only (a granted admin
 * reads other people's history in A8, never here). `?dose=<occurrence key>`
 * is where a reminder tap lands (public/sw.js opens the payload's url): the
 * dose's sheet opens with its current details, or a note says it changed.
 * With supplement tracking on, today's supplement routines are listed too
 * (R10), each with its own one-tap Taken; they never touch peptide stock.
 */
export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dose = typeof params.dose === "string" && KEY.test(params.dose) ? params.dose.toLowerCase() : null;
  const person = await requireResearcher(`/app/today${dose ? `?dose=${encodeURIComponent(dose)}` : ""}`);

  const db = await createClient();
  const now = new Date();
  // Today's supplement Taken records (yesterday included, for a zone seam).
  const supplementFrom = addDaysToDate(todayIn(now, SUPPLEMENT_TIME_ZONE), -1);
  const [cycles, records, library, mixtures, setups, tracking, vials, supplementTracking, routines, taken] = await Promise.all([
    listCycles(db, person.id),
    listDoseRecords(db, person.id),
    listCyclePeptides(db),
    planMixtures(db, person.id),
    planSetups(db, person.id),
    getSupplyTracking(db, person.id),
    listPersonalVials(db, person.id),
    getSupplementTracking(db, person.id),
    listRoutines(db, person.id),
    listTaken(db, person.id, { from: supplementFrom }),
  ]);
  const openVials = new Map<string, string>();
  if (tracking) for (const vial of vials) if (vial.mixtureId && !vial.finishedAt) openVials.set(vial.mixtureId, vial.label);
  const confirmations = confirmationsByCycle(records);
  // R8: a low, empty or over tracked vial beside the doses it serves.
  const tracked = vials.filter((vial) => tracking && vial.mixtureId && !vial.finishedAt);
  const stock = todayStockNotes({
    tracking,
    vials: tracked,
    mixtures,
    deductions: tracked.length ? await deductionsOfVials(db, tracked.map((vial) => vial.id)) : [],
    cycles,
    confirmations,
    now,
  });

  const view = todayView({
    cycles,
    confirmations,
    peptides: new Map(library.map((peptide) => [peptide.id, peptide])),
    mixtures,
    setups,
    vials: openVials,
    stock,
    now,
    requestedKey: dose,
  });

  return (
    <AppPage>
      <TodayScreen key={dose ?? ""} view={view} supplements={supplementsToday({ tracking: supplementTracking, routines, taken, now })} />
    </AppPage>
  );
}
