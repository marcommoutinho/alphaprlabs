import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { requireResearcher } from "@/lib/auth/session";
import { getResearchTemplate } from "@/lib/library/research";
import { phaseText, phaseWhen, TEMPLATE_INTRO, templateDays, WITHDRAWN_NOTE } from "@/lib/library/research-view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycle-views.css";
import "@/styles/app/research-library.css";

type Params = Promise<{ templateId: string }>;

/**
 * R6 Template detail: what a copy would receive, and "Use as starting
 * point" into the R3 builder. Not blocked by a peptide no longer offered
 * (Marco, 2026-09-26, superseding the plan's S10 line and the prototype):
 * the copy keeps it, and it shows here by name with the builder's note.
 */
export default async function TemplatePage({ params }: { params: Params }) {
  const { templateId } = await params;
  await requireResearcher(`/app/library/templates/${encodeURIComponent(templateId)}`);
  const db = await createClient();
  const template = await getResearchTemplate(db, templateId);
  if (!template) notFound();
  const peptides = new Map(template.peptides.map((peptide) => [peptide.id, peptide]));

  return (
    <AppPage width="support">
      <Link href="/app/library" className="app-cv-back">
        ‹ Library
      </Link>
      <div className="app-rl-template-top">
        <div>
          <div className="app-rl-kicker">Template · {templateDays(template)} days</div>
          <h1 className="app-h1 app-rl-template-title">{template.name}</h1>
        </div>
        <Link href={`/app/cycles/new?template=${template.id}`} className="app-btn app-btn--primary app-rl-use">
          Use as starting point
        </Link>
      </div>
      <p className="app-rl-intro app-rl-template-intro">{TEMPLATE_INTRO}</p>
      <div className="app-rl-sections app-rl-plans">
        {template.plans.map((plan) => {
          const peptide = peptides.get(plan.peptideId);
          return (
            <section key={plan.peptideId} className="app-rl-section" data-testid="template-plan">
              <b className="app-rl-plan-name">{peptide?.name ?? "Unknown peptide"}</b>
              {peptide && !peptide.available ? <div className="app-rl-withdrawn">{WITHDRAWN_NOTE}</div> : null}
              <div className="app-rl-phases">
                {plan.phases.map((phase, index) => (
                  <div key={index} className="app-rl-phase">
                    <span>{phaseWhen(phase)}</span>
                    <span>{phaseText(phase)}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {template.guidance ? (
        <section className="app-rl-section app-rl-guidance">
          <div className="app-rl-section-label">GUIDANCE · SUPPLIED BY ADMINS</div>
          <p>{template.guidance}</p>
        </section>
      ) : null}
    </AppPage>
  );
}
