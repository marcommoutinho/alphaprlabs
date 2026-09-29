// A10 Templates and D7 Template editor (design v3): the cards' and editor's
// text, the mini lanes and timeline, and the editor's phase rows. Pure and
// client-safe; shared by the screens and the tests (tests/unit/templates.test.ts).
//
// Marco, 2026-09-26: a template that names a peptide no longer offered can
// still be edited and saved, and researchers who start from it get the
// peptide too; it just can't be newly added to a template. So the card's
// `low` line only warns (A10's "can't be used by researchers" does not apply).
import { inMassUnit, type MassUnit, massUnit, mgFromUnit } from "@/lib/alpha/format";
import { type AxisLabel, type LaneBar, laneBars } from "@/lib/cycles/geometry";
import { formatMonthDay } from "@/lib/format";
import { BUSINESS_TIME_ZONE } from "@/lib/inventory/screens";
import type { Weekday } from "@/lib/schedule/engine";
import { newActivePhase, newBreak, type PhaseForm, type TemplatePeptide, type TemplatePhase, type TemplatePlan, templatePlanToEngine, type TemplateRecord } from "./rules";

export const TEMPLATE_CREATED = "Template created.";
export const TEMPLATE_UPDATED = "Template updated for future copies. Existing cycles unchanged.";
export const NO_TEMPLATES = "No templates yet";
export const NO_TEMPLATES_BODY = "A template is a starting point researchers copy into their own cycle and adjust.";
export const GUIDANCE_LABEL = "Guidance shown with the template";

/** Total length in days: the last day any phase reaches. */
export function templateDays(template: Pick<TemplateRecord, "plans">): number {
  const ends = template.plans.flatMap((plan) => plan.phases.map((phase) => phase.offset + phase.len));
  return ends.length ? Math.max(...ends) : 0;
}

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const cyclesText = (n: number) => `${n} ${n === 1 ? "cycle" : "cycles"}`;
const updatedText = (at: string) => formatMonthDay(at, { timeZone: BUSINESS_TIME_ZONE });

/** A10's mono length: "84 days". */
export const templateLength = (template: Pick<TemplateRecord, "plans">) => daysText(templateDays(template));

/** A10's last line: "Used for 4 cycles · updated Aug 28" (the date in Toronto). */
export const usageLine = (template: Pick<TemplateRecord, "cycleCount" | "updatedAt">) =>
  `${template.cycleCount ? `Used for ${cyclesText(template.cycleCount)}` : "Not used yet"} · updated ${updatedText(template.updatedAt)}`;

/** D7's meta: "84 days · used for 4 cycles · updated Aug 28" ("not used yet" before any cycle). */
export const editorMeta = (template: Pick<TemplateRecord, "plans" | "cycleCount" | "updatedAt">) =>
  `${templateLength(template)} · ${template.cycleCount ? `used for ${cyclesText(template.cycleCount)}` : "not used yet"} · updated ${updatedText(template.updatedAt)}`;

/** D7's footer note. */
export function footerNote(template: Pick<TemplateRecord, "cycleCount"> | null): string {
  if (!template) return "Researchers will see it as a starting point once it's saved.";
  const n = template.cycleCount;
  if (n === 0) return "Saving changes future copies only. No cycle has been started from this template yet.";
  return `Saving changes future copies only. The ${n === 1 ? "1 cycle" : `${n} cycles`} started from this template won't change.`;
}

const names = (list: readonly string[]) => (list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

/** The peptides it names that are no longer offered (or unknown), in its order. */
export function withdrawnNames(template: Pick<TemplateRecord, "plans">, peptides: ReadonlyMap<string, TemplatePeptide>): string[] {
  return template.plans.filter((plan) => peptides.get(plan.peptideId)?.available !== true).map((plan) => peptides.get(plan.peptideId)?.name ?? "Unknown peptide");
}

/** A10's `low` line: "Includes PT-141, no longer offered", or null. */
export function withdrawnLine(template: Pick<TemplateRecord, "plans">, peptides: ReadonlyMap<string, TemplatePeptide>): string | null {
  const list = withdrawnNames(template, peptides);
  return list.length ? `Includes ${names(list)}, no longer offered` : null;
}

/** D7's notice above the peptides when it names one no longer offered. */
export function withdrawnNotice(template: Pick<TemplateRecord, "plans">, peptides: ReadonlyMap<string, TemplatePeptide>): string | null {
  const list = withdrawnNames(template, peptides);
  if (!list.length) return null;
  return `${names(list)} ${list.length === 1 ? "is" : "are"} no longer offered. The template keeps ${list.length === 1 ? "it" : "them"} and researchers who start from it still get ${list.length === 1 ? "it" : "them"}; once removed, ${list.length === 1 ? "it" : "they"} can't be added back.`;
}

// ── Lanes ───────────────────────────────────────────────────────────────────

/** The synthetic start the lanes are laid out from (day 1). */
const ANCHOR = "2001-01-01";

export type TemplateLane = { peptideId: string; bars: LaneBar[] };

/**
 * One lane per peptide over the template's length: bar height follows the
 * dose, breaks hatched (the cycle lanes' geometry, src/lib/cycles/geometry.ts).
 */
export function templateLanes(template: Pick<TemplateRecord, "plans">): { total: number; lanes: TemplateLane[] } {
  const total = Math.max(1, templateDays(template));
  return {
    total,
    lanes: template.plans.map((plan) => ({
      peptideId: plan.peptideId,
      bars: laneBars(templatePlanToEngine(plan, { planId: plan.peptideId, start: ANCHOR, timeZone: "UTC" }).phases, ANCHOR, total),
    })),
  };
}

/** D7's day axis: Day 1, each phase's first day where it fits, and the last day. */
export function laneAxis(lanes: readonly TemplateLane[], total: number): AxisLabel[] {
  if (total < 1) return [];
  const labels: AxisLabel[] = [{ text: "Day 1", percent: 0, align: "start" }];
  const starts = [...new Set(lanes.flatMap((lane) => lane.bars.map((bar) => bar.from)))].filter((day) => day > 1).sort((a, b) => a - b);
  for (const day of starts) {
    const percent = ((day - 1) / total) * 100;
    if (percent <= 90 && labels.every((label) => Math.abs(label.percent - percent) >= 7)) labels.push({ text: String(day), percent, align: "center" });
  }
  if (total > 1) labels.push({ text: String(total), percent: 100, align: "end" });
  return labels;
}

// ── D7's phase rows ─────────────────────────────────────────────────────────

export type Frequency = "daily" | "every" | "weekdays";

/**
 * A phase as the D7 table edits it: its days as "from – to", the dose in
 * the unit it is typed in (mcg under 1 mg), and the schedule as Daily,
 * Every N days or Weekdays. `formOfRow` turns it back into the template
 * form the shared validation reads (src/lib/templates/rules.ts).
 */
export type PhaseRow = {
  key: string;
  kind: "active" | "break";
  from: string;
  to: string;
  amount: string;
  unit: MassUnit;
  frequency: Frequency;
  every: string;
  days: Weekday[];
  time: string;
};

const whole = (text: string): number | null => (/^\s*\d{1,9}\s*$/.test(text) ? Number(text.trim()) : null);

export function rowOfPhase(phase: PhaseForm, key: string): PhaseRow {
  const from = whole(phase.day);
  const len = whole(phase.len);
  const unit = phase.mg ? massUnit(phase.mg) : "mg";
  return {
    key,
    kind: phase.kind,
    from: phase.day,
    to: from !== null && len !== null ? String(from + len - 1) : "",
    amount: phase.mg ? inMassUnit(phase.mg, unit) : "",
    unit,
    frequency: phase.schedule === "weekdays" ? "weekdays" : phase.every.trim() === "1" ? "daily" : "every",
    every: phase.every,
    days: [...phase.days],
    time: phase.time,
  };
}

export function formOfRow(row: PhaseRow): PhaseForm {
  const from = whole(row.from);
  const to = whole(row.to);
  return {
    kind: row.kind,
    day: row.from,
    len: from !== null && to !== null ? String(to - from + 1) : "",
    mg: row.amount.trim() ? mgFromUnit(row.amount, row.unit) : "",
    time: row.time,
    schedule: row.frequency === "weekdays" ? "weekdays" : "interval",
    every: row.frequency === "daily" ? "1" : row.every,
    days: [...row.days],
  };
}

/** "+ Phase" / "+ Break": the day after the last row ends, 28 days (a break 14), daily at 08:00. */
export function newRow(kind: "active" | "break", rows: readonly PhaseRow[], key: string): PhaseRow {
  const ends = rows.map((row) => whole(row.to) ?? whole(row.from) ?? 0);
  const day = (ends.length ? Math.max(...ends) : 0) + 1;
  const base = kind === "active" ? { ...newActivePhase(day), every: "1" } : { ...newBreak(day), len: "14" };
  return rowOfPhase(base, key);
}

/** D7's weekday toggles: seven 30 px squares, Mon … Sun, one letter each. */
export const WEEKDAY_TOGGLES = [
  { day: 1, letter: "M", label: "Mon" },
  { day: 2, letter: "T", label: "Tue" },
  { day: 3, letter: "W", label: "Wed" },
  { day: 4, letter: "T", label: "Thu" },
  { day: 5, letter: "F", label: "Fri" },
  { day: 6, letter: "S", label: "Sat" },
  { day: 0, letter: "S", label: "Sun" },
] as const;

/** A template's plans as lanes need them while being edited: only the rows that read as a phase. */
export function draftPlans(plans: readonly { peptideId: string; rows: readonly PhaseRow[] }[]): TemplatePlan[] {
  return plans.map((plan) => ({
    peptideId: plan.peptideId,
    phases: plan.rows.flatMap((row): TemplatePhase[] => {
      const form = formOfRow(row);
      const day = whole(form.day);
      const len = whole(form.len);
      if (day === null || len === null || day < 1 || len < 1 || day - 1 + len > 3660) return [];
      if (row.kind === "break") return [{ kind: "break" as const, offset: day - 1, len }];
      const dose = /^\d*\.?\d+$/.test(form.mg) && Number(form.mg) > 0 ? form.mg : "1";
      return [
        {
          kind: "active" as const,
          offset: day - 1,
          len,
          doseMg: dose,
          time: form.time || "08:00",
          schedule: form.schedule === "weekdays" ? { type: "weekdays" as const, days: form.days.length ? form.days : [1 as Weekday] } : { type: "interval" as const, everyDays: Math.max(1, whole(form.every) ?? 1) },
        },
      ];
    }),
  }));
}
