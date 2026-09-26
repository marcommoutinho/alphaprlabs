// A3 Cycle templates: the list's and editor's display text (handoff
// docs/design/research-app/README.md "A3 Cycle templates"; the prototype's
// copy). Pure and shared by the screen and the tests.
import { formatMonthDay } from "@/lib/format";
import { BUSINESS_TIME_ZONE } from "@/lib/inventory/screens";
import type { PhaseForm, TemplatePeptide, TemplateRecord } from "./rules";

export const TEMPLATES_SUBTITLE =
  "Starting points researchers copy. Editing a template changes future copies only — existing researcher cycles are untouched.";
export const RECEIVE_HELPER =
  "Days count from the researcher's start date (day 1). They can adjust everything after copying.";
export const IDLE = "Select a template to inspect or update it.";
/** Not in the prototype, which always had seeded templates. */
export const NO_TEMPLATES = "No templates yet.";
export const UNAVAILABLE_WARNING = "Includes a peptide that is no longer offered — researchers can't start from it.";
export const TEMPLATE_CREATED = "Template created.";
export const TEMPLATE_UPDATED = "Template updated for future copies. Existing cycles unchanged.";

/** The note under Save: existing templates vs a new one. */
export function scopeNote(isNew: boolean): string {
  return isNew
    ? "Researchers will see this as a starting point."
    : "Saving updates future copies only. Cycles already created from this template are not changed.";
}

/** The editor card's title; follows the name as it is typed. */
export function templateEditorTitle(isNew: boolean, name: string): string {
  return isNew ? "New template" : `Edit ${name.trim() || "template"}`;
}

/** Total length in days: the last day any phase reaches. */
export function templateDays(template: Pick<TemplateRecord, "plans">): number {
  const ends = template.plans.flatMap((plan) => plan.phases.map((phase) => phase.offset + phase.len));
  return ends.length ? Math.max(...ends) : 0;
}

/** `63 days · updated Aug 28` (the date in the business time zone). */
export function templateMeta(template: Pick<TemplateRecord, "plans" | "updatedAt">): string {
  return `${templateDays(template)} days · updated ${formatMonthDay(template.updatedAt, { timeZone: BUSINESS_TIME_ZONE })}`;
}

const nameOf = (peptides: ReadonlyMap<string, TemplatePeptide>, id: string) => peptides.get(id)?.name ?? "Unknown peptide";

/** `Compound A · 2 phase(s) + Compound B · 1 phase(s)`: active phases per peptide. */
export function templateSummary(template: Pick<TemplateRecord, "plans">, peptides: ReadonlyMap<string, TemplatePeptide>): string {
  if (template.plans.length === 0) return "No peptides yet";
  return template.plans
    .map((plan) => `${nameOf(peptides, plan.peptideId)} · ${plan.phases.filter((phase) => phase.kind === "active").length} phase(s)`)
    .join(" + ");
}

/** The warning line when a peptide in it is no longer offered; null otherwise. */
export function templateWarning(template: Pick<TemplateRecord, "plans">, peptides: ReadonlyMap<string, TemplatePeptide>): string | null {
  return template.plans.some((plan) => !peptides.get(plan.peptideId)?.available) ? UNAVAILABLE_WARNING : null;
}

/** `N researcher cycle(s) were started from it — they won't change.` */
export function templateUsage(cycleCount: number): string {
  return `${cycleCount} researcher cycle(s) were started from it — they won't change.`;
}

/** A phase block's title, e.g. `Active phase` + `· day 1–29`, or `Break` + `· day 30–36`. */
export function phaseTitle(phase: Pick<PhaseForm, "kind" | "day" | "len">): { word: string; range: string } {
  const day = /^\d{1,9}$/.test(phase.day.trim()) ? Number(phase.day.trim()) : Number.NaN;
  const len = /^\d{1,9}$/.test(phase.len.trim()) ? Number(phase.len.trim()) : Number.NaN;
  return {
    word: phase.kind === "active" ? "Active phase" : "Break",
    range: day >= 1 && len >= 1 ? `· day ${day}–${day + len - 1}` : "",
  };
}

/** Weekday toggles in the design's order, Mon … Sun (0 = Sunday). */
export const WEEKDAY_TOGGLES = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
] as const;
