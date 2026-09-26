import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { requireResearcher } from "@/lib/auth/session";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import { cycleSummary, listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { cycleRow, groupCycles } from "@/lib/cycles/views";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycles.css";
import "@/styles/app/cycle-views.css";

/**
 * R2 Cycles: the caller's own cycles only (listCycles by owner; a granted
 * admin's support view of someone else's history is A8, S17), grouped
 * Current / Upcoming / Past by status, each with its next dose from the
 * engine across every revision. Recorded doses (S12) will be passed to
 * cycleOccurrences; until then there are none.
 */
export default async function CyclesPage() {
  const person = await requireResearcher("/app/cycles");
  const db = await createClient();
  const [cycles, library] = await Promise.all([listCycles(db, person.id), listCyclePeptides(db)]);
  const peptides = new Map(library.map((peptide) => [peptide.id, peptide]));
  const now = new Date();
  const groups = groupCycles(
    cycles.map((cycle) => cycleRow(cycle, cycleSummary(cycle, now), cycleOccurrences(cycle.revisions, []), peptides, now)),
  );

  return (
    <AppPage>
      <div className="app-cyc-list-head">
        <h1 className="app-h1">Cycles</h1>
        <div className="app-cyc-list-actions">
          <Link href="/app/library" className="app-btn app-btn--secondary app-btn--sm">
            From a template
          </Link>
          <Link href="/app/cycles/new" className="app-btn app-btn--primary app-btn--sm">
            Custom cycle
          </Link>
        </div>
      </div>

      {cycles.length === 0 ? (
        <div className="app-cv-empty">
          <h2>No cycles yet</h2>
          <p>A cycle holds one or more peptide plans, each with its own dates and schedule.</p>
        </div>
      ) : null}

      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.title} aria-label={group.title} data-testid="cycle-group">
            <h2 className="app-cv-group">{group.title}</h2>
            {group.rows.map((row) => (
              <Link key={row.id} href={`/app/cycles/${row.id}`} className="app-cv-card" data-testid="cycle-card">
                <span className="app-cv-card-head">
                  <span className="app-cv-card-name">{row.name}</span>
                  <span className="app-cv-status" data-status={row.status}>
                    {row.status}
                  </span>
                </span>
                <span className="app-cv-card-meta">
                  {row.dates} · {row.peptides}
                </span>
                <span className="app-cv-card-next">{row.nextLine}</span>
                {row.unconfirmed > 0 ? <span className="app-cv-card-open">{row.unconfirmed} unconfirmed</span> : null}
              </Link>
            ))}
          </section>
        ))}
    </AppPage>
  );
}
