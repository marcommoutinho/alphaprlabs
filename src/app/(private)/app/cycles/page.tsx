import { CyclesList } from "@/components/research/cycles/cycles-list";
import { requireResearcher } from "@/lib/auth/session";
import { cycleCard, groupCards } from "@/lib/cycles/screens";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { ownerConfirmations } from "@/lib/doses/service";
import { createClient } from "@/lib/supabase/server";

/**
 * R10 Cycles (design v3): the caller's own cycles only (listCycles by owner;
 * a granted admin's support view of someone else's history is A8), grouped
 * Active (in a break included) / Upcoming / Ended, each with its day, next
 * dose and adherence from the engine across every revision, with the
 * recorded doses and skips. Loading and error: ./loading.tsx, ./error.tsx.
 */
export default async function CyclesPage() {
  const person = await requireResearcher("/app/cycles");
  const db = await createClient();
  const [cycles, library, confirmations] = await Promise.all([listCycles(db, person.id), listCyclePeptides(db), ownerConfirmations(db, person.id)]);
  const peptides = new Map(library.map((peptide) => [peptide.id, peptide]));
  const now = new Date();
  const cards = cycles.map((cycle) => cycleCard(cycle, confirmations.get(cycle.id) ?? [], peptides, now));
  return <CyclesList groups={groupCards(cards)} />;
}
