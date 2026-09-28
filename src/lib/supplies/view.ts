// R8 Personal supplies: what the screen shows (design v3 R7: vials in use,
// unopened and finished), and Today's low-stock notes. Pure: built from the researcher's vials,
// mixtures, deductions, cycles and recorded doses. See ./estimate for the
// estimate and the low-stock rule.
import { vialName } from "./name";
import { massLabel } from "@/lib/alpha/format";
import { Exact } from "@/lib/calculator/decimal";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import { occurrenceWhen } from "@/lib/cycles/views";
import { formatDate, formatDateTime, formatDay, formatMonthDay } from "@/lib/format";
import { concentrationOf, type Mixture, mixtureLabel } from "@/lib/mixtures/rules";
import type { PersonalVial } from "@/lib/mixtures/service";
import type { Confirmation } from "@/lib/schedule/engine";
import type { InstantInput } from "@/lib/schedule/zone";
import {
  OVER_STATE,
  outlookFor,
  outlookLine,
  type PlannedDose,
  remainingLabel,
  type StockOutlook,
  todayStockNote,
  upcomingByPlan,
  vialEstimate,
  type VialEstimate,
  vialState,
} from "./estimate";
import { ESTIMATE_NOTE, MIXTURE_DELETED_LINE, NOT_MIXED_LINE } from "./rules";

/** A deduction as the screen needs it (src/lib/supplies/service VialDeduction). */
export type DeductionInput = {
  id: string;
  /** A dose, or a correction the researcher made (R7); absent means a dose. */
  kind?: "dose" | "correction";
  /** The recorded dose; null for a correction. */
  doseId: string | null;
  vialId: string;
  /** Its position on its vial (the order the estimate is counted in); absent in older fixtures. */
  sequence?: number;
  amountMg: string;
  remainingBeforeMg: string;
  remainingAfterMg: string;
  stockDiscrepancy: boolean;
  /** When it was recorded (a correction's date). */
  recordedAt?: string;
};

/** The recorded dose behind a deduction. */
export type DoseInput = { id: string; cycleId: string; occurrenceKey: string; actualAt: string };

export type HistoryEntry = {
  id: string;
  kind: "dose" | "correction";
  /** "Sat Sep 26 · 08:05" in the dose's cycle zone, or "" when the dose isn't readable. */
  when: string;
  cycleName: string;
  /** "400 mcg" (what a dose took, or how far a correction moved the estimate). */
  amount: string;
  /** "−400 mcg" for a dose; "Corrected −300 mcg" / "Corrected +1 mg" for a correction. */
  change: string;
  /** "7.6 mg left", or "200 mcg over" past the vial's contents. */
  after: string;
  discrepancy: boolean;
  /** The dose's sheet on Today, which shows what was recorded. */
  href: string | null;
};

/** The R7 tag beside a vial that needs attention. */
export type VialTag = "Low" | "Empty" | "Over";

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
  /** "7.2 mg · 1.8 mL" (the mL at the mixture's concentration). */
  remaining: string;
  /** "3 confirmed doses deducted" */
  uses: string;
  /** "Mixture 8 mg / 2 mL · An estimate …", or how to link it. */
  mixLine: string;
  /** The low-stock outlook, or null. */
  outlook: string | null;
  /** Newest first. */
  history: HistoryEntry[];
  // ── Design v3 R7 ──
  /** "BPC-157 · 10 mg" */
  title: string;
  /** "Vial 3 · mixed Sep 17 · 5 mg/mL" */
  meta: string;
  /** "1.5 mg left", "0 mg left", "200 mcg over" */
  left: string;
  tag: VialTag | null;
  /** "6 doses · to Mon Sep 28", "Less than the next 400 mcg dose", or why it can't be judged; null when finished. */
  forecast: string | null;
  /** The estimate the screen shows, exact (negative when over): "Correct remaining" sends it back as what was seen. */
  remainingMg: string;
};

/** Unopened vials of one peptide and strength (R7 "BPC-157 · 10 mg  × 2"). */
export type UnopenedGroup = { key: string; title: string; peptideId: string; strengthMg: string; vials: VialCard[] };

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
  /** Open vials that are mixed or have been used, by peptide name. */
  inUse: VialCard[];
  /** Open vials never mixed nor used, grouped by peptide and strength. */
  unopened: UnopenedGroup[];
  /** Finished vials, the most recently finished first. */
  finished: VialCard[];
  /** Open vials tagged Low, Empty or Over (the sidebar's "N low"). */
  lowCount: number;
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

export { vialName };

/**
 * Deductions by vial, in the order they were counted: each one's "before" is
 * the one before's "after". The vial's sequence is that order; rows without
 * one (older fixtures) fall back to the estimate going down.
 */
function deductionsByVial(deductions: readonly DeductionInput[]): Map<string, DeductionInput[]> {
  const byVial = new Map<string, DeductionInput[]>();
  for (const d of deductions) {
    const list = byVial.get(d.vialId);
    if (list) list.push(d);
    else byVial.set(d.vialId, [d]);
  }
  for (const list of byVial.values())
    list.sort((a, b) =>
      a.sequence !== undefined && b.sequence !== undefined
        ? a.sequence - b.sequence
        : new Exact(b.remainingBeforeMg).comparedTo(a.remainingBeforeMg) || a.id.localeCompare(b.id),
    );
  return byVial;
}

/** "200 mcg over" or "7.6 mg left" for a stored remaining amount. */
const afterLabel = (remainingMg: string) =>
  remainingMg.startsWith("-") ? `${massLabel(remainingMg.slice(1))} over` : `${massLabel(remainingMg)} left`;

/** R7's forecast under the meter. */
function forecastLine(outlook: StockOutlook, estimateState: VialEstimate["state"], mixed: boolean): string {
  if (estimateState === "over") return "More recorded than the vial held";
  if (estimateState === "empty") return "Nothing left by the estimate";
  if (outlook.kind === "unknown") {
    if (!mixed) return "Not mixed yet";
    return outlook.reason === "no-plan" ? "No cycle uses this mixture" : "No dose planned ahead";
  }
  if (outlook.low) return `Less than the next ${massLabel(outlook.next.doseMg)} dose`;
  const last = outlook.lastCovered ? ` · to ${formatDay(outlook.lastCovered.localDate)}` : "";
  return `${plural(outlook.dosesLeft, "dose")}${last}${outlook.coversAll ? " · every planned dose" : ""}`;
}

/** Everything R7 shows as of `now`. */
export function suppliesView(input: SuppliesInput): SuppliesView {
  const mixtures = new Map(input.mixtures.map((m) => [m.id, m]));
  const cycles = new Map(input.cycles.map((c) => [c.id, c]));
  const doses = new Map(input.doses.map((d) => [d.id, d]));
  const byVial = deductionsByVial(input.deductions);
  const upcoming = upcomingByPlan(input.cycles, input.confirmations, input.now);
  const zone = displayZone(input.cycles);
  const nameOf = (peptideId: string) => input.peptides.get(peptideId)?.name ?? "Unknown peptide";

  // Each dose in its own occurrence's zone, as Today's sheet and the cycle's
  // history show it (a cycle that moved zones keeps earlier doses in theirs).
  const zones = new Map<string, Map<string, string>>();
  const zoneOf = (cycleId: string, key: string): string | undefined => {
    let byKey = zones.get(cycleId);
    if (!byKey) {
      const cycle = cycles.get(cycleId);
      byKey = new Map(cycle ? cycleOccurrences(cycle.revisions, input.confirmations.get(cycleId) ?? []).map((o) => [o.key, o.timeZone]) : []);
      zones.set(cycleId, byKey);
    }
    return byKey.get(key);
  };

  const history = (d: DeductionInput): HistoryEntry => {
    if (d.kind === "correction") {
      const moved = new Exact(d.amountMg);
      return {
        id: d.id,
        kind: "correction",
        when: d.recordedAt ? formatDateTime(d.recordedAt, { timeZone: zone }) : "",
        cycleName: "",
        amount: massLabel(moved.abs().toFixed()),
        // The amount is what the estimate went down by; negative means more was found.
        change: `Corrected ${moved.isNegative() ? "+" : "−"}${massLabel(moved.abs().toFixed())}`,
        after: afterLabel(d.remainingAfterMg),
        discrepancy: false,
        href: null,
      };
    }
    const dose = d.doseId ? doses.get(d.doseId) : undefined;
    const cycle = dose ? cycles.get(dose.cycleId) : undefined;
    const timeZone = (dose && zoneOf(dose.cycleId, dose.occurrenceKey)) ?? cycle?.revisions.at(-1)?.timeZone ?? zone;
    return {
      id: d.id,
      kind: "dose",
      when: dose ? formatDateTime(dose.actualAt, { timeZone }) : "",
      cycleName: cycle?.name ?? "",
      amount: massLabel(d.amountMg),
      change: `−${massLabel(d.amountMg)}`,
      after: afterLabel(d.remainingAfterMg),
      discrepancy: d.stockDiscrepancy,
      href: dose ? `/app/today?dose=${encodeURIComponent(dose.occurrenceKey)}` : null,
    };
  };

  const card = (vial: PersonalVial): VialCard & { used: boolean } => {
    const deductions = byVial.get(vial.id) ?? [];
    const estimate = vialEstimate(vial.strengthMg, deductions);
    const mixture = vial.mixtureId ? (mixtures.get(vial.mixtureId) ?? null) : null;
    const open = vial.finishedAt === null;
    const outlook = outlookFor(estimate, mixture?.id ?? null, mixture?.planIds ?? [], upcoming);
    const state = open ? vialState(estimate, outlook, mixture !== null) : null;
    const mixLine = mixture
      ? `Mixture ${mixture.setup.vialMg} mg / ${mixture.setup.liquidMl} mL · ${ESTIMATE_NOTE}`
      : !open
        ? ESTIMATE_NOTE
        : vial.mixtureId
          ? MIXTURE_DELETED_LINE
          : NOT_MIXED_LINE;
    const tag: VialTag | null = !open
      ? null
      : estimate.state === "over"
        ? "Over"
        : estimate.state === "empty"
          ? "Empty"
          : outlook.kind === "known" && outlook.low
            ? "Low"
            : null;
    const when = vial.finishedAt
      ? `finished ${formatMonthDay(vial.finishedAt, { timeZone: zone })}`
      : vial.mixedAt
        ? `mixed ${formatMonthDay(vial.mixedAt, { timeZone: zone })}`
        : `added ${formatMonthDay(vial.createdAt, { timeZone: zone })}`;
    const concentration = mixture ? `${concentrationOf(mixture.setup)} mg/mL` : null;
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
      title: `${nameOf(vial.peptideId)} · ${massLabel(vial.strengthMg)}`,
      meta: [vialName(vial.label), when, open ? concentration : null].filter(Boolean).join(" · "),
      left: estimate.state === "over" ? `${massLabel(estimate.overMg!)} over` : `${massLabel(estimate.remainingMg)} left`,
      tag,
      forecast: open ? forecastLine(outlook, estimate.state, mixture !== null) : null,
      remainingMg: estimate.remainingMg,
      used: deductions.length > 0 || vial.mixedAt !== null || vial.mixtureId !== null,
    };
  };

  const byName = (a: VialCard, b: VialCard) => a.peptideName.localeCompare(b.peptideName) || a.peptideId.localeCompare(b.peptideId);
  const inUse: VialCard[] = [];
  const unopened = new Map<string, UnopenedGroup>();
  const finished: { card: VialCard; at: string }[] = [];
  // listPersonalVials' order (oldest first) within each group.
  for (const vial of input.vials) {
    const { used, ...view } = card(vial);
    if (!view.open) finished.push({ card: view, at: vial.finishedAt! });
    else if (used) inUse.push(view);
    else {
      const key = `${vial.peptideId}:${vial.strengthMg}`;
      const group = unopened.get(key) ?? { key, title: view.title, peptideId: vial.peptideId, strengthMg: vial.strengthMg, vials: [] };
      group.vials.push(view);
      unopened.set(key, group);
    }
  }

  const openVial = new Map(input.vials.filter((v) => v.mixtureId && v.finishedAt === null).map((v) => [v.mixtureId!, v.label]));
  const own = new Set([...input.mixtures.map((m) => m.peptideId), ...input.vials.map((v) => v.peptideId)]);
  const sortedInUse = inUse.sort(byName);
  return {
    tracking: input.tracking,
    inUse: sortedInUse,
    unopened: [...unopened.values()].sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key)),
    finished: finished.sort((a, b) => b.at.localeCompare(a.at)).map((f) => f.card),
    lowCount: sortedInUse.filter((v) => v.tag !== null).length,
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

/** A tracked open vial that is low, empty or over: Today's "Supplies" row (design v3 R1 §6). */
export type LowVialRow = {
  vialId: string;
  /** "BPC-157 · 10 mg vial A-02" */
  title: string;
  /** "Low · 300 mcg left, less than the next 400 mcg dose" (design v3 units: under 1 mg in mcg) */
  status: string;
};

export type TodaySupply = {
  /** todayStockNotes' notes, by plan id. */
  notes: Map<string, string>;
  /** Each tracked open vial's estimate now, by mixture id (R2's "Vial after"). */
  vials: Map<string, { label: string; strengthMg: string; remainingMg: string }>;
  low: LowVialRow[];
};

/**
 * Everything Today shows about personal supplies (V1): the R8 notes beside
 * doses, the estimate R2 counts "Vial after" down from, and the low vial rows.
 * Low is the R8 rule (less than the next planned dose; Marco's rule wins over
 * the design's "3 days"). Nothing while tracking is off.
 */
export function todaySupply(input: TodayStockInput & { peptideNames?: ReadonlyMap<string, string> }): TodaySupply {
  const supply: TodaySupply = { notes: todayStockNotes(input), vials: new Map(), low: [] };
  if (!input.tracking) return supply;
  const byMixture = new Map<string, Mixture>();
  for (const mixture of input.mixtures.values()) byMixture.set(mixture.id, mixture);
  const byVial = deductionsByVial(input.deductions);
  let upcoming: Map<string, PlannedDose[]> | null = null;
  for (const vial of input.vials) {
    const mixture = vial.mixtureId && vial.finishedAt === null ? byMixture.get(vial.mixtureId) : undefined;
    if (!mixture) continue;
    upcoming ??= upcomingByPlan(input.cycles, input.confirmations, input.now);
    const estimate = vialEstimate(vial.strengthMg, byVial.get(vial.id) ?? []);
    supply.vials.set(mixture.id, { label: vial.label, strengthMg: vial.strengthMg, remainingMg: estimate.remainingMg });
    const outlook = outlookFor(estimate, mixture.id, mixture.planIds, upcoming);
    const name = input.peptideNames?.get(vial.peptideId) ?? "";
    const title = `${name ? `${name} · ` : ""}${massLabel(vial.strengthMg)} ${vialName(vial.label, true)}`;
    if (estimate.state === "over") supply.low.push({ vialId: vial.id, title, status: OVER_STATE });
    else if (estimate.state === "empty") supply.low.push({ vialId: vial.id, title, status: "Empty · 0 mg left (estimate)" });
    else if (outlook.kind === "known" && outlook.low)
      supply.low.push({
        vialId: vial.id,
        title,
        status: `Low · ${massLabel(estimate.remainingMg)} left, less than the next ${massLabel(outlook.next.doseMg)} dose`,
      });
  }
  return supply;
}
