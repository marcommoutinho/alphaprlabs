import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { CycleBuilder } from "@/components/research/cycle-builder";
import { requireResearcher } from "@/lib/auth/session";
import { timeZoneOptions } from "@/lib/cycles/display";
import { editWindow } from "@/lib/cycles/revise";
import { addDays, formOfCycle } from "@/lib/cycles/rules";
import { getCycle, listCyclePeptides } from "@/lib/cycles/service";
import { localDateOf } from "@/lib/schedule/zone";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ cycleId: string }>;

/**
 * R3 "Edit future plan" (R4's action, S10): the owner's cycle only; a
 * granted admin reads cycles elsewhere but never edits them. Phases that have
 * ended are read-only and phases under way keep their start; the save
 * applies from each peptide's effective date (reviseCycle).
 */
export default async function EditCyclePage({ params }: { params: Params }) {
  const { cycleId } = await params;
  const person = await requireResearcher(`/app/cycles/${encodeURIComponent(cycleId)}/edit`);
  const db = await createClient();
  const [cycle, peptides] = await Promise.all([getCycle(db, cycleId), listCyclePeptides(db)]);
  if (!cycle || cycle.ownerId !== person.id) notFound();

  const current = cycle.revisions[cycle.revisions.length - 1];
  const now = new Date();
  const today = localDateOf(now, current.timeZone);
  // Recorded doses (S12) will be passed to editWindow too.
  const { effective, locks } = editWindow(current, now);

  return (
    <AppPage>
      <CycleBuilder
        initial={formOfCycle(cycle, effective, today)}
        peptides={peptides}
        zones={timeZoneOptions(["UTC", current.timeZone])}
        defaultStart={addDays(today, 1)}
        locks={Object.fromEntries(locks)}
        effective={Object.fromEntries(effective)}
      />
    </AppPage>
  );
}
