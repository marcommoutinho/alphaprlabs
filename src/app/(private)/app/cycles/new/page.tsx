import { notFound } from "next/navigation";
import { CycleBuilder } from "@/components/research/cycles/builder/cycle-builder";
import { requireResearcher } from "@/lib/auth/session";
import { type BuilderMix, builderFromForm, mixFrom } from "@/lib/cycles/builder";
import { timeZoneOptions } from "@/lib/cycles/display";
import { type CycleForm, type CyclePeptide, DATES_ZONE, formFromTemplate, tomorrowIn } from "@/lib/cycles/rules";
import { getTemplateForCopy, listCyclePeptides } from "@/lib/cycles/service";
import { listMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const CUSTOM: CycleForm = { cycleId: null, version: null, templateId: null, name: "", timeZone: "", goal: "", baseline: "", plans: [] };

/** "Recovery stack, GLP-1 starter and 4 more" (R4a's template row). */
function templatesLine(names: readonly string[]): string | null {
  if (!names.length) return null;
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * R4a–c New cycle (design v3): custom, or `?template=<id>` to start from a
 * supplied template, prefilled (R10 "Browse templates", the Library's "Use
 * as starting point"). Day 1 is tomorrow in the cycle's time zone until the
 * researcher picks a start (it may be in the past); the copy is the
 * researcher's own, including any peptide the template names that is no
 * longer offered (Marco, 2026-09-26). A peptide the researcher already has a
 * saved mix for starts from it.
 */
export default async function NewCyclePage({ searchParams }: { searchParams: SearchParams }) {
  const { template: templateParam } = await searchParams;
  const templateId = typeof templateParam === "string" ? templateParam : null;
  const person = await requireResearcher(templateId ? `/app/cycles/new?template=${encodeURIComponent(templateId)}` : "/app/cycles/new");
  const db = await createClient();
  const [library, mixtures, templateNames] = await Promise.all([
    listCyclePeptides(db),
    listMixtures(db, person.id),
    db.from("cycle_templates").select("name").order("name").limit(50),
  ]);
  let peptides: CyclePeptide[] = library;
  // The server renders before it knows the device's zone: day 1 starts as
  // tomorrow in DATES_ZONE, and the builder moves it to the chosen zone's.
  const now = new Date().toISOString();
  const start = tomorrowIn(now, DATES_ZONE);

  // The newest saved mix per peptide (listMixtures is newest first).
  const savedMixes: Record<string, BuilderMix> = {};
  for (const mixture of mixtures) savedMixes[mixture.peptideId] ??= mixFrom(mixture, false);

  let form = CUSTOM;
  let templateName: string | null = null;
  if (templateId) {
    const template = await getTemplateForCopy(db, templateId);
    if (!template) notFound();
    form = formFromTemplate(template, start, "");
    templateName = template.name;
    // Names for the template's peptides the library no longer lists.
    const known = new Set(peptides.map((peptide) => peptide.id));
    peptides = [...peptides, ...template.peptides.filter((peptide) => !known.has(peptide.id))];
  }
  const initial = builderFromForm(form, start, { mixes: new Map(Object.entries(savedMixes)) });

  return (
    <CycleBuilder
      initial={initial}
      peptides={peptides}
      zones={timeZoneOptions(["UTC"])}
      now={now}
      datesZone={DATES_ZONE}
      templateName={templateName}
      templates={templatesLine((templateNames.data ?? []).map((row) => row.name))}
      savedMixes={savedMixes}
    />
  );
}
