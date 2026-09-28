import { notFound } from "next/navigation";
import { CycleBuilder } from "@/components/research/cycles/builder/cycle-builder";
import { requireResearcher } from "@/lib/auth/session";
import { builderForEdit } from "@/lib/cycles/builder";
import { timeZoneOptions } from "@/lib/cycles/display";
import { getCycle, listCyclePeptides } from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { listMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ cycleId: string }>;

/**
 * "Edit future plan" (R3's Edit, D2's button) in the v3 builder: the
 * owner's cycle only; a granted admin reads cycles elsewhere but never edits
 * them. Phases that have ended are read-only, phases under way keep their
 * start (so day 1 stays put once anything has started), a peptide with a
 * dose already due, taken or skipped can't be removed; the save applies from
 * each peptide's effective date (reviseCycle). Each peptide's mix starts
 * from the saved mixture it uses now.
 */
export default async function EditCyclePage({ params }: { params: Params }) {
  const { cycleId } = await params;
  const person = await requireResearcher(`/app/cycles/${encodeURIComponent(cycleId)}/edit`);
  const db = await createClient();
  const [cycle, peptides, mixtures] = await Promise.all([getCycle(db, cycleId), listCyclePeptides(db), listMixtures(db, person.id)]);
  if (!cycle || cycle.ownerId !== person.id) notFound();
  const confirmations = await cycleConfirmations(db, cycle.id);

  const current = cycle.revisions[cycle.revisions.length - 1];
  const now = new Date();
  // Recorded doses and skips: never replaced, and they count as started.
  const { initial, savedMixes, effective, startLocked } = builderForEdit(cycle, confirmations, mixtures, now);

  return (
    <CycleBuilder
      initial={initial}
      peptides={peptides}
      zones={timeZoneOptions(["UTC", current.timeZone])}
      now={now.toISOString()}
      datesZone={current.timeZone}
      savedMixes={savedMixes}
      effective={effective}
      startLocked={startLocked}
    />
  );
}
