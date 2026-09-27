import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { MeSignOut, MeSupportSection } from "@/components/research/me-support";
import { requireResearcher } from "@/lib/auth/session";
import { getSupplyTracking, listPersonalVials } from "@/lib/mixtures/service";
import { getSupplementTracking, listRoutines } from "@/lib/supplements/service";
import { listShareHistory } from "@/lib/support/service";
import { meSupport, SUPPORT_INTRO, suppliesSummary, supplementsSummary } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/support.css";

/**
 * R11 Me: the signed-in person's profile, links to their reminders,
 * personal supplies and supplement routines (with a summary of each optional
 * feature), support access (share the full history, read-only, with the
 * Alpha PR Labs team, or stop sharing, each behind a confirm step, and when
 * it was shared before) and sign out. Only ever the caller's own records,
 * and never an admin's name.
 */
export default async function MePage() {
  const person = await requireResearcher("/app/me");
  const db = await createClient();
  const [shares, supplyTracking, vials, supplementTracking, routines] = await Promise.all([
    listShareHistory(db, person.id),
    getSupplyTracking(db, person.id),
    listPersonalVials(db, person.id),
    getSupplementTracking(db, person.id),
    listRoutines(db, person.id),
  ]);
  const support = meSupport(shares);

  return (
    <AppPage width="narrow">
      <h1 className="app-h1">{person.name}</h1>
      <div className="app-me-sub">
        {person.email} · {person.role === "admin" ? "Admin" : "Researcher"} · acknowledgement accepted
      </div>

      <nav className="app-me-links" aria-label="Your settings">
        <Link href="/app/notifications" className="app-me-link">
          <span>Reminders on this phone</span>
          <span className="app-me-link-meta">›</span>
        </Link>
        <Link href="/app/supplies" className="app-me-link">
          <span>
            Personal supplies <span className="app-me-optional">optional</span>
          </span>
          <span className="app-me-link-meta" data-testid="me-supplies">
            {suppliesSummary(supplyTracking, vials.filter((vial) => vial.finishedAt === null).length)} ›
          </span>
        </Link>
        <Link href="/app/supplements" className="app-me-link">
          <span>
            Supplement routines <span className="app-me-optional">optional</span>
          </span>
          <span className="app-me-link-meta" data-testid="me-supplements">
            {supplementsSummary(supplementTracking, routines, new Date())} ›
          </span>
        </Link>
      </nav>

      <section className="app-me-support" aria-labelledby="me-support">
        <h2 id="me-support" className="app-me-h2">
          Support access
        </h2>
        <p className="app-me-intro">{SUPPORT_INTRO}</p>
        <MeSupportSection support={support} />
      </section>

      <div className="app-me-foot">
        <MeSignOut />
        <span className="app-me-zone">Check-ins and supplements use America/Toronto time; each cycle keeps its own time zone.</span>
      </div>
    </AppPage>
  );
}
