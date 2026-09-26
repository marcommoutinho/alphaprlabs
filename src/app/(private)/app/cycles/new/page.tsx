import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { CycleBuilder } from "@/components/research/cycle-builder";
import { requireResearcher } from "@/lib/auth/session";
import { TEMPLATE_BLOCKED, timeZoneOptions } from "@/lib/cycles/display";
import { addDays, type CycleForm, formFromTemplate } from "@/lib/cycles/rules";
import { getTemplateForCopy, listCyclePeptides } from "@/lib/cycles/service";
import { BUSINESS_TIME_ZONE } from "@/lib/inventory/screens";
import { localDateOf } from "@/lib/schedule/zone";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycles.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const CUSTOM: CycleForm = {
  cycleId: null,
  revision: null,
  templateId: null,
  name: "",
  timeZone: "",
  goal: "",
  baseline: "",
  plans: [],
};

/**
 * R3 New cycle: custom, or `?template=<id>` to start from a supplied
 * template (R6 "Use as starting point", S10). The copy's phases get dates
 * from tomorrow; it is the researcher's own from then on.
 */
export default async function NewCyclePage({ searchParams }: { searchParams: SearchParams }) {
  const { template: templateParam } = await searchParams;
  const templateId = typeof templateParam === "string" ? templateParam : null;
  await requireResearcher(templateId ? `/app/cycles/new?template=${encodeURIComponent(templateId)}` : "/app/cycles/new");
  const db = await createClient();
  const peptides = await listCyclePeptides(db);
  // Tomorrow, as in the prototype. The cycle's zone is chosen in the builder;
  // the business zone stands in for the date until then.
  const tomorrow = addDays(localDateOf(new Date(), BUSINESS_TIME_ZONE), 1);

  let initial = CUSTOM;
  let templateName: string | undefined;
  if (templateId) {
    const template = await getTemplateForCopy(db, templateId, peptides);
    if (!template) notFound();
    if (!template.usable) {
      return (
        <AppPage>
          <Link href="/app/cycles" className="app-cyc-back">
            ‹ Cycles
          </Link>
          <h1 className="app-h1 app-cyc-title">{template.name}</h1>
          <p className="app-cyc-blocked" role="alert">
            {TEMPLATE_BLOCKED}
          </p>
        </AppPage>
      );
    }
    initial = formFromTemplate(template, tomorrow, "");
    templateName = template.name;
  }

  return (
    <AppPage>
      <CycleBuilder initial={initial} peptides={peptides} zones={timeZoneOptions(["UTC"])} defaultStart={tomorrow} templateName={templateName} />
    </AppPage>
  );
}
