import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { CycleHistory } from "@/components/research/cycle-history";
import { CycleTimeline } from "@/components/research/cycle-timeline";
import { requireResearcher } from "@/lib/auth/session";
import { getCycle } from "@/lib/cycles/service";
import { cycleDetail } from "@/lib/cycles/views";
import { cycleConfirmations } from "@/lib/doses/service";
import { planMixtureLine } from "@/lib/mixtures/rules";
import { planMixtures } from "@/lib/mixtures/service";
import { peptidesByIds } from "@/lib/library/research";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycle-views.css";

type Params = Promise<{ cycleId: string }>;

/**
 * R4 Cycle detail: the owner's cycle only (a granted admin reads other
 * people's cycles in A8, S17, never here). Per-peptide timeline with phase
 * bars and dose markers from the engine across every revision, the plan
 * cards with each plan's saved mixture (S11), and scheduled vs actual with
 * the recorded doses (S12); an unconfirmed dose links to its R5 sheet.
 */
export default async function CyclePage({ params }: { params: Params }) {
  const { cycleId } = await params;
  const person = await requireResearcher(`/app/cycles/${encodeURIComponent(cycleId)}`);
  const db = await createClient();
  const cycle = await getCycle(db, cycleId);
  if (!cycle || cycle.ownerId !== person.id) notFound();

  const ids = cycle.revisions.flatMap((revision) => revision.plans.map((plan) => plan.peptideId));
  const [library, confirmations, mixtures] = await Promise.all([
    peptidesByIds(db, ids),
    cycleConfirmations(db, cycle.id),
    planMixtures(db, person.id),
  ]);
  const peptides = new Map(library.map((peptide) => [peptide.id, peptide]));
  const detail = cycleDetail(cycle, peptides, new Date(), confirmations);

  return (
    <AppPage>
      <Link href="/app/cycles" className="app-cv-back">
        ‹ Cycles
      </Link>
      <div className="app-cv-head">
        <div>
          <div className="app-cv-status-line" data-status={detail.status}>
            {detail.statusLine}
          </div>
          <h1 className="app-cv-title">{cycle.name}</h1>
          <div className="app-cv-meta" data-testid="cycle-meta">
            {detail.meta}
          </div>
        </div>
        <div className="app-cv-actions">
          <Link href="/app/progress" className="app-btn app-btn--secondary app-btn--sm">
            Results
          </Link>
          <Link href={`/app/cycles/${cycle.id}/edit`} className="app-btn app-btn--primary app-btn--sm">
            Edit future plan
          </Link>
        </div>
      </div>

      <CycleTimeline timeline={detail.timeline} />

      <div className="app-cv-plans">
        {detail.plans.map((plan) => (
          <section key={plan.planId} className="app-cv-plan" data-testid="cycle-plan-card">
            <div className="app-cv-plan-head">
              <h2>{plan.name}</h2>
              {plan.availability ? <span className="app-cv-plan-availability">{plan.availability}</span> : null}
            </div>
            <div className="app-cv-phases">
              {plan.phases.map((phase, index) => (
                <div key={index} className="app-cv-phase" data-current={phase.current || undefined}>
                  <span className="app-cv-phase-word">{phase.word}</span>
                  <span className="app-cv-phase-text">
                    {phase.text}
                    <span className="app-cv-phase-sub">{phase.sub}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="app-cv-mix" data-slot="saved-mixture">
              {planMixtureLine(mixtures.get(plan.planId) ?? null)}{" "}
              <Link href={`/app/calculator?plan=${plan.planId}`}>{mixtures.has(plan.planId) ? "Change" : "Set one up"}</Link>
            </div>
            {plan.guidance ? (
              <div className="app-cv-guidance">
                <span className="app-cv-guidance-label">SUPPLIED GUIDANCE · ADMIN</span>
                {plan.guidance}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <section className="app-cv-history" aria-labelledby="cycle-history-title">
        <div className="app-cv-history-head">
          <h2 id="cycle-history-title">Scheduled vs actual</h2>
          <span>Planned · actual · entered are kept apart</span>
        </div>
        <CycleHistory rows={detail.history} />
      </section>
    </AppPage>
  );
}
