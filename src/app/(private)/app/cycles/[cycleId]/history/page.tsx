import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { HistoryList, HistoryTable } from "@/components/research/cycles/history";
import { requireResearcher } from "@/lib/auth/session";
import { cycleScreen } from "@/lib/cycles/screens";
import { getCycle } from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { peptidesByIds } from "@/lib/library/research";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ cycleId: string }>;

/**
 * R3's "See all" (D2's "All"): the cycle's whole history, newest first, the
 * owner's only. Missed doses link to their log-late sheet on Today.
 */
export default async function CycleHistoryPage({ params }: { params: Params }) {
  const { cycleId } = await params;
  const person = await requireResearcher(`/app/cycles/${encodeURIComponent(cycleId)}/history`);
  const db = await createClient();
  const cycle = await getCycle(db, cycleId);
  if (!cycle || cycle.ownerId !== person.id) notFound();
  const ids = cycle.revisions.flatMap((revision) => revision.plans.map((plan) => plan.peptideId));
  const [library, confirmations] = await Promise.all([peptidesByIds(db, ids), cycleConfirmations(db, cycle.id)]);
  const screen = cycleScreen(cycle, confirmations, new Map(library.map((peptide) => [peptide.id, peptide])), new Map(), new Date());
  const back = `/app/cycles/${cycle.id}`;

  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="History" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link prefetch={false} href={back} className="flex h-11 min-w-0 items-center gap-0.5">
          <ChevronLeft className="size-[26px] shrink-0" aria-hidden />
          <span className="truncate">{cycle.name}</span>
        </Link>
      </nav>
      <header className="px-5 pt-1.5 laptop:px-0 laptop:pt-0">
        <Link prefetch={false} href={back} className="hidden text-[14px] text-signal-ink laptop:block">
          ‹ {cycle.name}
        </Link>
        <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">History</h1>
        <p className="mt-1 font-mono text-[13px] font-medium text-ink-3">
          {screen.history.length} {screen.history.length === 1 ? "dose" : "doses"} · adherence {screen.tiles.adherence.value}
          {screen.tiles.adherence.unit}
        </p>
      </header>
      {screen.history.length ? (
        <>
          <HistoryList items={screen.history} className="mx-5 mt-3 laptop:hidden" />
          <div className="mt-4 hidden rounded-[24px] border border-line bg-surface px-6 py-2 laptop:block">
            <HistoryTable items={screen.history} />
          </div>
        </>
      ) : (
        <p className="mx-5 mt-4 text-[15px] text-ink-2 laptop:mx-0">No doses yet. They appear here once their day comes.</p>
      )}
    </main>
  );
}
