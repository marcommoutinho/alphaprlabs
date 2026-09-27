import { AppPage } from "@/components/app-shell/app-shell";
import { Calculator } from "@/components/research/calculator";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords } from "@/lib/doses/service";
import { linkablePlans } from "@/lib/mixtures/plans";
import { blankForm, type CalculatorForm, formFromMixture } from "@/lib/mixtures/rules";
import { getSupplyTracking, listMixtures, listPersonalVials } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/calculator.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value.toLowerCase() : null);

/**
 * R7 Calculator. Converts the dose the researcher enters (S7's math; nothing
 * is rounded) and saves the setup as a mixture linked to cycle peptide plans.
 * `?mixture=<id>` opens a saved mixture; `?plan=<id>` opens a cycle plan's
 * mixture (or a new one for its peptide) with its dose today, else its next
 * planned dose (the "Set one up" links from a cycle and Today).
 */
export default async function CalculatorPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mixtureParam = one(params.mixture);
  const planParam = one(params.plan);
  const query = mixtureParam ? `?mixture=${encodeURIComponent(mixtureParam)}` : planParam ? `?plan=${encodeURIComponent(planParam)}` : "";
  const person = await requireResearcher(`/app/calculator${query}`);

  const db = await createClient();
  const [peptides, mixtures, cycles, vials, tracking, records] = await Promise.all([
    listCyclePeptides(db),
    listMixtures(db, person.id),
    listCycles(db, person.id),
    listPersonalVials(db, person.id),
    getSupplyTracking(db, person.id),
    listDoseRecords(db, person.id),
  ]);
  const plans = linkablePlans(cycles, mixtures, new Date(), confirmationsByCycle(records));

  let initial: CalculatorForm = blankForm(peptides.find((peptide) => peptide.available)?.id ?? "");
  let linked: string[] = [];
  const plan = planParam ? plans.find((p) => p.planId === planParam) : undefined;
  const opened = mixtures.find((m) => m.id === (plan ? plan.mixtureId : mixtureParam));
  if (opened) {
    initial = formFromMixture(opened, plan?.doseMg ?? "");
    linked = opened.planIds;
  } else if (plan) {
    initial = { ...blankForm(plan.peptideId), doseMg: plan.doseMg ?? "" };
    linked = [plan.planId];
  }

  // "vial A-01 tracked": an open vial on a mixture, while tracking is on.
  const trackedVials: Record<string, string> = {};
  if (tracking) for (const vial of vials) if (vial.mixtureId && !vial.finishedAt) trackedVials[vial.mixtureId] = vial.label;

  return (
    <AppPage>
      <Calculator
        key={`${mixtureParam ?? ""}/${planParam ?? ""}`}
        initial={initial}
        initialLinked={linked}
        peptides={peptides}
        mixtures={mixtures}
        plans={plans}
        trackedVials={trackedVials}
      />
    </AppPage>
  );
}
