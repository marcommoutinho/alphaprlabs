// R8 Personal supplies: what the screen shows (the prototype's supplies view),
// and Today's low-stock notes. Pure: built from the researcher's vials,
// mixtures, deductions, cycles and recorded doses. See ./estimate for the
// estimate and the low-stock rule.
import { Exact } from "@/lib/calculator/decimal";
import type { CycleRecord } from "@/lib/cycles/rules";
import { occurrenceWhen } from "@/lib/cycles/views";
import { formatDate, formatDateTime } from "@/lib/format";
import { type Mixture, mixtureLabel } from "@/lib/mixtures/rules";
import type { PersonalVial } from "@/lib/mixtures/service";
import type { Confirmation } from "@/lib/schedule/engine";
import type { InstantInput } from "@/lib/schedule/zone";
import {
  mgLabel,
  outlookFor,
  outlookLine,
  type PlannedDose,
  remainingLabel,
  todayStockNote,
  upcomingByPlan,
  vialEstimate,
  vialState,
} from "./estimate";
import { ESTIMATE_NOTE, MIXTURE_DELETED_LINE, NOT_MIXED_LINE } from "./rules";

/** A deduction as the screen needs it (src/lib/supplies/service VialDeduction). */
export type DeductionInput = {
  id: string;
  doseId: string;
  vialId: string;
  amountMg: string;
  remainingBeforeMg: string;
  remainingAfterMg: string;
  stockDiscrepancy: boolean;
};

/** The recorded dose behind a deduction. */
export type DoseInput = { id: string; cycleId: string; occurrenceKey: string; actualAt: string };

export type HistoryEntry = {
  id: string;
  /** "Sat Sep 26 · 08:05" in the dose's cycle zone, or "" when the dose isn't readable. */
  when: string;
  cycleName: string;
  /** "0.4 mg" */
  amount: string;
  /** "7.6 mg left", or "0.2 mg over" past the vial's contents. */
  after: string;
  discrepancy: boolean;
  /** The dose's sheet on Today, which shows what was recorded. */
  href: string | null;
};

export type VialCard = {
  id: string;
  label: string;
  peptideId: string;
  peptideName: string;
  strengthMg: string;
  mixtureId: string | null;
  open: boolean;
  /** "Finished Sep 26, 2026" for a finished vial. */
  finished: string | null;
  state: string;
  tone: "quiet" | "warn" | "alert";
  /** Bar width, 0–100. */
  percent: number;
  remaining: string;
  /** "3 confirmed doses deducted" */
  uses: string;
  /** "Mixture 8 mg / 2 mL · An estimate …", or how to link it. */
  mixLine: string;
  /** The low-stock outlook, or null. */
  outlook: string | null;
  /** Newest first. */
  history: HistoryEntry[];
};

export type VialGroup = { peptideId: string; name: string; vials: VialCard[] };

/** A saved mixture offered in the vial forms. */
export type MixtureOption = {
  id: string;
  peptideId: string;
  /** "Compound A · 8 mg / 2 mL · 1 mL" */
  label: string;
  strengthMg: string;
  /** The label of its open vial, if any (one open vial per mixture). */
  openVial: string | null;
};

export type SuppliesView = {
  tracking: boolean;
  groups: VialGroup[];
  hasVials: boolean;
  mixtures: MixtureOption[];
  /** Peptides a "Not mixed yet" vial may be added for: offered ones, and those in the researcher's own mixtures or vials. */
  peptides: { id: string; name: string }[];
  /** Every label in use (for the default "Vial N"). */
  labels: string[];
};

export type SuppliesInput = {
  tracking: boolean;
  vials: readonly PersonalVial[];
  /** Saved mixtures not deleted (listMixtures). */
  mixtures: readonly Mixture[];
  peptides: ReadonlyMap<string, { name: string; available: boolean }>;
  deductions: readonly DeductionInput[];
  doses: readonly DoseInput[];
  cycles: readonly CycleRecord[];
  confirmations: ReadonlyMap<string, readonly Confirmation[]>;
  now: InstantInput;
};

/** The zone for dates that belong to no dose: the newest cycle's, else the business's. */
export const displayZone = (cycles: readonly CycleRecord[]) => cycles[0]?.revisions.at(-1)?.timeZone ?? "America/Toronto";

/** A plan's next dose as "Mon Sep 28 · 08:00" in its zone. */
const whenOf = (dose: PlannedDose) => occurrenceWhen(dose);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Deductions by vial, in the order they were taken: each one's "before" is the one before's "after". */
function deductionsByVial(deductions: readonly DeductionInput[]): Map<string, DeductionInput[]> {
  const byVial = new Map<string, DeductionInput[]>();
  for (const d of deductions) {
    const list = byVial.get(d.vialId);
    if (list) list.push(d);
    else byVial.set(d.vialId, [d]);
  }
  for (const list of byVial.values()) list.sort((a, b) => new Exact(b.remainingBeforeMg).comparedTo(a.remainingBeforeMg) || a.id.localeCompare(b.id));
  return byVial;
}

/** Everything R8 shows as of `now`. */
export function suppliesView(input: SuppliesInput): SuppliesView {
  const mixtures = new Map(input.mixtures.map((m) => [m.id, m]));
  const cycles = new Map(input.cycles.map((c) => [c.id, c]));
  const doses = new Map(input.doses.map((d) => [d.id, d]));
  const byVial = deductionsByVial(input.deductions);
  const upcoming = upcomingByPlan(input.cycles, input.confirmations, input.now);
  const zone = displayZone(input.cycles);
  const nameOf = (peptideId: string) => input.peptides.get(peptideId)?.name ?? "Unknown peptide";

  const history = (d: DeductionInput): HistoryEntry => {
    const dose = doses.get(d.doseId);
    const cycle = dose ? cycles.get(dose.cycleId) : undefined;
    const timeZone = cycle?.revisions.at(-1)?.timeZone ?? zone;
    const after = d.remainingAfterMg.startsWith("-") ? `${mgLabel(d.remainingAfterMg.slice(1))} over` : `${mgLabel(d.remainingAfterMg)} left`;
    return {
      id: d.id,
      when: dose ? formatDateTime(dose.actualAt, { timeZone }) : "",
      cycleName: cycle?.name ?? "",
      amount: mgLabel(d.amountMg),
      after,
      discrepancy: d.stockDiscrepancy,
      href: dose ? `/app/today?dose=${encodeURIComponent(dose.occurrenceKey)}` : null,
    };
  };

  const card = (vial: PersonalVial): VialCard => {
    const deductions = byVial.get(vial.id) ?? [];
    const estimate = vialEstimate(vial.strengthMg, deductions);
    const mixture = vial.mixtureId ? (mixtures.get(vial.mixtureId) ?? null) : null;
    const open = vial.finishedAt === null;
    const outlook = outlookFor(estimate, mixture?.id ?? null, mixture?.planIds ?? [], upcoming);
    const state = open ? vialState(estimate, outlook, mixture !== null) : null;
    const mixLine = mixture
      ? `Mixture ${mixture.setup.vialMg} mg / ${mixture.setup.liquidMl} mL · ${ESTIMATE_NOTE}`
      : vial.mixtureId
        ? MIXTURE_DELETED_LINE
        : open
          ? NOT_MIXED_LINE
          : ESTIMATE_NOTE;
    return {
      id: vial.id,
      label: vial.label,
      peptideId: vial.peptideId,
      peptideName: nameOf(vial.peptideId),
      strengthMg: vial.strengthMg,
      mixtureId: vial.mixtureId,
      open,
      finished: vial.finishedAt ? `Finished ${formatDate(vial.finishedAt, { timeZone: zone })}` : null,
      state: state?.text ?? (estimate.state === "over" ? "Finished · estimate exceeded the vial" : "Finished"),
      tone: state?.tone ?? (estimate.state === "over" ? "alert" : "quiet"),
      percent: estimate.percentLeft,
      remaining: remainingLabel(estimate, open && mixture ? mixture.setup : null),
      uses: `${plural(estimate.uses, "confirmed dose")} deducted`,
      mixLine,
      outlook: open && mixture ? outlookLine(outlook, whenOf) : null,
      history: deductions.map(history).reverse(),
    };
  };

  const groups = new Map<string, VialGroup>();
  // Open vials first, then finished ones, each oldest first (listPersonalVials' order).
  const ordered = [...input.vials.filter((v) => v.finishedAt === null), ...input.vials.filter((v) => v.finishedAt !== null)];
  for (const vial of ordered) {
    const group = groups.get(vial.peptideId) ?? { peptideId: vial.peptideId, name: nameOf(vial.peptideId), vials: [] };
    group.vials.push(card(vial));
    groups.set(vial.peptideId, group);
  }

  const openVial = new Map(input.vials.filter((v) => v.mixtureId && v.finishedAt === null).map((v) => [v.mixtureId!, v.label]));
  const own = new Set([...input.mixtures.map((m) => m.peptideId), ...input.vials.map((v) => v.peptideId)]);
  return {
    tracking: input.tracking,
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.peptideId.localeCompare(b.peptideId)),
    hasVials: input.vials.length > 0,
    mixtures: input.mixtures.map((m) => ({
      id: m.id,
      peptideId: m.peptideId,
      label: mixtureLabel(nameOf(m.peptideId), m.setup),
      strengthMg: m.setup.vialMg,
      openVial: openVial.get(m.id) ?? null,
    })),
    peptides: [...input.peptides]
      .filter(([id, p]) => p.available || own.has(id))
      .map(([id, p]) => ({ id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    labels: input.vials.map((v) => v.label),
  };
}

export type TodayStockInput = {
  tracking: boolean;
  vials: readonly PersonalVial[];
  /** The mixture each plan uses now, by plan id (planMixtures). */
  mixtures: ReadonlyMap<string, Mixture>;
  /** Deductions from the open vials (at least). */
  deductions: readonly DeductionInput[];
  cycles: readonly CycleRecord[];
  confirmations: ReadonlyMap<string, readonly Confirmation[]>;
  now: InstantInput;
};

/**
 * Today's notes, by plan id: for each plan whose current mixture has an open
 * tracked vial that is low (less than the next planned dose), empty or over,
 * "Vial A-02 is low · 0.2 mg left (estimate)". Nothing while tracking is off.
 */
export function todayStockNotes(input: TodayStockInput): Map<string, string> {
  const notes = new Map<string, string>();
  if (!input.tracking) return notes;
  const byMixture = new Map<string, Mixture>();
  for (const mixture of input.mixtures.values()) byMixture.set(mixture.id, mixture);
  const byVial = deductionsByVial(input.deductions);
  let upcoming: Map<string, PlannedDose[]> | null = null;
  for (const vial of input.vials) {
    const mixture = vial.mixtureId && vial.finishedAt === null ? byMixture.get(vial.mixtureId) : undefined;
    if (!mixture) continue;
    upcoming ??= upcomingByPlan(input.cycles, input.confirmations, input.now);
    const estimate = vialEstimate(vial.strengthMg, byVial.get(vial.id) ?? []);
    const note = todayStockNote(vial.label, estimate, outlookFor(estimate, mixture.id, mixture.planIds, upcoming));
    if (note) for (const planId of mixture.planIds) notes.set(planId, note);
  }
  return notes;
}
