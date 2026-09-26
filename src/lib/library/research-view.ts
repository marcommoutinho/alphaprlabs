// R6 Library, peptide detail and template detail: display text (handoff
// docs/design/research-app/README.md "R6 Library / Peptide detail / Template
// detail"; the prototype's lib, pv and tv views). Pure and shared by the
// screens and the tests.
//
// Marco, 2026-09-26: a template naming a peptide no longer offered can still
// be used as a starting point, and the copy keeps that peptide. The
// prototype's blocked button and its "can't be used" warning are replaced by
// the peptide's name with WITHDRAWN_NOTE (the builder's own note).
import { normalizeDecimal } from "@/lib/calculator/decimal";
import { WITHDRAWN_NOTE } from "@/lib/cycles/display";
import type { TemplatePhase, TemplatePlan } from "@/lib/templates/rules";

export { WITHDRAWN_NOTE };

export const LIBRARY_INTRO =
  "Peptide information, templates and guidance supplied by admins. Templates are starting points; the copy you create is yours.";
export const TEMPLATE_INTRO =
  "Amounts and schedules below are what you'd receive as an editable copy. Dates are relative to the start day you choose.";
export const NO_TEMPLATES_MATCH = "No templates match.";
export const noPeptidesMatch = (query: string) => `No peptides match “${query}”.`;
/** Not in the prototype, which always had seeded content. */
export const NO_TEMPLATES = "No templates yet.";
export const NO_PEPTIDES = "No peptides yet.";
export const TEMPLATE_CARD_WARNING = "Includes a peptide no longer offered for new cycles.";

export const INFO_EMPTY = "No information supplied yet.";
export const CYCLING_OFF_EMPTY = "No cycling-off guidance supplied for this peptide.";
export const SUPPLEMENT_EMPTY = "No supplement guidance supplied for this peptide.";
export const AVAILABLE_BADGE = "Available for new cycles";

type Named = ReadonlyMap<string, { name: string; available: boolean }>;
const nameOf = (peptides: Named, id: string) => peptides.get(id)?.name ?? "Unknown peptide";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The list row's second line: which texts the entry has. */
export function peptideSub(entry: { cyclingOff: string; supplement: string }): string {
  return ["Information", entry.cyclingOff ? "cycling-off guidance" : null, entry.supplement ? "supplement guidance" : null]
    .filter(Boolean)
    .join(" · ");
}

/** `In your cycles: A, B` or `Not used in any of your cycles.` */
export function usedIn(cycleNames: readonly string[]): string {
  return cycleNames.length ? `In your cycles: ${cycleNames.join(", ")}` : "Not used in any of your cycles.";
}

/** Total length in days: the last day any phase reaches. */
export function templateDays(template: { plans: TemplatePlan[] }): number {
  const ends = template.plans.flatMap((plan) => plan.phases.map((phase) => phase.offset + phase.len));
  return ends.length ? Math.max(...ends) : 0;
}

/** `Compound A · 2 phases + Compound B · 1 phase`: active phases per peptide. */
export function templateSummary(template: { plans: TemplatePlan[] }, peptides: Named): string {
  return template.plans
    .map((plan) => {
      const n = plan.phases.filter((phase) => phase.kind === "active").length;
      return `${nameOf(peptides, plan.peptideId)} · ${n} phase${n === 1 ? "" : "s"}`;
    })
    .join(" + ");
}

/** True when a peptide it names is no longer offered. */
export function includesWithdrawn(template: { plans: TemplatePlan[] }, peptides: Named): boolean {
  return template.plans.some((plan) => peptides.get(plan.peptideId)?.available !== true);
}

/** `Day 1–29` */
export const phaseWhen = (phase: TemplatePhase) => `Day ${phase.offset + 1}–${phase.offset + phase.len}`;

/** `Break`, `0.4 mg · every 5 days · 20:00` or `0.3 mg · Mon/Wed/Fri · 07:30`. */
export function phaseText(phase: TemplatePhase): string {
  if (phase.kind === "break") return "Break";
  const { schedule } = phase;
  const days: readonly number[] = schedule.type === "weekdays" ? schedule.days : [];
  const when =
    schedule.type === "interval"
      ? `every ${schedule.everyDays} day${schedule.everyDays === 1 ? "" : "s"}`
      : WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join("/");
  return `${normalizeDecimal(phase.doseMg) ?? phase.doseMg} mg · ${when} · ${phase.time}`;
}

/** What the library search matches for a template, lower-cased: its name and the peptides it names. */
export function templateSearchText(template: { name: string; plans: TemplatePlan[] }, peptides: Named): string[] {
  return [template.name, ...template.plans.map((plan) => nameOf(peptides, plan.peptideId))].map((text) => text.toLowerCase());
}
