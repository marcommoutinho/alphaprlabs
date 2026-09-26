import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { formatDate } from "@/lib/format";
import { BUSINESS_TIME_ZONE } from "@/lib/inventory/screens";
import { getAvailablePeptide } from "@/lib/library/research";
import { AVAILABLE_BADGE, CYCLING_OFF_EMPTY, INFO_EMPTY, SUPPLEMENT_EMPTY, usedIn } from "@/lib/library/research-view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycle-views.css";
import "@/styles/app/research-library.css";

type Params = Promise<{ peptideId: string }>;

/**
 * R6 Peptide detail: read-only admin content for an entry still offered.
 * A withdrawn entry is not browsable (Marco, 2026-09-26), so it is not
 * found here; cycles that use it still show it. "In your cycles" lists only
 * the caller's own cycles.
 */
export default async function PeptidePage({ params }: { params: Params }) {
  const { peptideId } = await params;
  const person = await requireResearcher(`/app/library/peptides/${encodeURIComponent(peptideId)}`);
  const db = await createClient();
  const peptide = await getAvailablePeptide(db, peptideId);
  if (!peptide) notFound();
  const cycles = await listCycles(db, person.id);
  const names = cycles
    .filter((cycle) => cycle.revisions.some((revision) => revision.plans.some((plan) => plan.peptideId === peptide.id)))
    .map((cycle) => cycle.name);

  return (
    <AppPage width="narrow">
      <Link href="/app/library" className="app-cv-back">
        ‹ Library
      </Link>
      <h1 className="app-h1 app-rl-title">{peptide.name}</h1>
      <div className="app-rl-badge-line">
        {AVAILABLE_BADGE} · updated {formatDate(peptide.updatedAt, { timeZone: BUSINESS_TIME_ZONE })}
      </div>
      <div className="app-rl-sections">
        <section className="app-rl-section">
          <div className="app-rl-section-label">INFORMATION · SUPPLIED BY ADMINS</div>
          <p>{peptide.information || INFO_EMPTY}</p>
        </section>
        <section className="app-rl-section">
          <div className="app-rl-section-label">CYCLING OFF · SUPPLIED BY ADMINS</div>
          <p>{peptide.cyclingOff || CYCLING_OFF_EMPTY}</p>
        </section>
        <section className="app-rl-section">
          <div className="app-rl-section-label">SUPPORTING SUPPLEMENTS · SUPPLIED BY ADMINS</div>
          <p>{peptide.supplement || SUPPLEMENT_EMPTY}</p>
          {peptide.supplement ? (
            <p className="app-rl-section-note">
              Reading this doesn&apos;t start anything. <Link href="/app/supplements">Create a supplement routine</Link> if you want
              reminders.
            </p>
          ) : null}
        </section>
      </div>
      <div className="app-rl-used">{usedIn(names)}</div>
    </AppPage>
  );
}
