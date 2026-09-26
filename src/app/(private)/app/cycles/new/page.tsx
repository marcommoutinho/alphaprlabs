import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { CycleBuilder } from "@/components/research/cycle-builder";
import { requireResearcher } from "@/lib/auth/session";
import { timeZoneOptions } from "@/lib/cycles/display";
import { type CycleForm, type CyclePeptide, DATES_ZONE, formFromTemplate, tomorrowIn } from "@/lib/cycles/rules";
import { getTemplateForCopy, listCyclePeptides } from "@/lib/cycles/service";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycles.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const CUSTOM: CycleForm = {
  cycleId: null,
  version: null,
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
 * from tomorrow in the cycle's time zone; it is the researcher's own from
 * then on, including any peptide the template names that is no longer
 * offered (Marco, 2026-09-26).
 */
export default async function NewCyclePage({ searchParams }: { searchParams: SearchParams }) {
  const { template: templateParam } = await searchParams;
  const templateId = typeof templateParam === "string" ? templateParam : null;
  await requireResearcher(templateId ? `/app/cycles/new?template=${encodeURIComponent(templateId)}` : "/app/cycles/new");
  const db = await createClient();
  let peptides: CyclePeptide[] = await listCyclePeptides(db);
  // The builder computes "tomorrow" in the zone chosen for the cycle (the
  // device's until one is picked) from this instant, and moves the dates it
  // set itself when the zone changes. The server renders before it knows the
  // device's zone, so these first dates are DATES_ZONE's.
  const now = new Date().toISOString();

  let initial = CUSTOM;
  let templateName: string | undefined;
  if (templateId) {
    const template = await getTemplateForCopy(db, templateId);
    if (!template) notFound();
    initial = formFromTemplate(template, tomorrowIn(now, DATES_ZONE), "");
    templateName = template.name;
    // Names for the template's peptides the library no longer lists.
    const known = new Set(peptides.map((peptide) => peptide.id));
    peptides = [...peptides, ...template.peptides.filter((peptide) => !known.has(peptide.id))];
  }

  return (
    <AppPage>
      <CycleBuilder initial={initial} peptides={peptides} zones={timeZoneOptions(["UTC"])} now={now} templateName={templateName} />
    </AppPage>
  );
}
