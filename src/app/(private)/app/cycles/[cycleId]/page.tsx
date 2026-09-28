import { notFound } from "next/navigation";
import { CycleDetail } from "@/components/research/cycles/cycle-detail";
import { requireResearcher } from "@/lib/auth/session";
import { cycleScreen } from "@/lib/cycles/screens";
import { getCycle } from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { peptidesByIds } from "@/lib/library/research";
import { planMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ cycleId: string }>;

/**
 * R3 Cycle detail (phone) and D2 (laptop), design v3: the owner's cycle
 * only (a granted admin reads other people's cycles in A8, never here). The
 * day of the cycle, adherence with missed and skipped doses, each peptide's
 * lane, phases and saved mix, and the history, from the engine across every
 * revision with the recorded doses and skips. A missed dose links to its
 * log-late sheet on Today (R2b).
 */
export default async function CyclePage({ params }: { params: Params }) {
  const { cycleId } = await params;
  const person = await requireResearcher(`/app/cycles/${encodeURIComponent(cycleId)}`);
  const db = await createClient();
  const cycle = await getCycle(db, cycleId);
  if (!cycle || cycle.ownerId !== person.id) notFound();

  const ids = cycle.revisions.flatMap((revision) => revision.plans.map((plan) => plan.peptideId));
  const [library, confirmations, mixtures] = await Promise.all([peptidesByIds(db, ids), cycleConfirmations(db, cycle.id), planMixtures(db, person.id)]);
  const peptides = new Map(library.map((peptide) => [peptide.id, peptide]));
  return <CycleDetail screen={cycleScreen(cycle, confirmations, peptides, mixtures, new Date())} />;
}
