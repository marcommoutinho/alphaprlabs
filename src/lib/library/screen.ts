// R11 Library and R12 Peptide detail (design v3): what the researcher's
// library list and a peptide's page show. Pure and client-safe; unit-tested
// (tests/unit/library-screen.test.ts).
//
// The library holds only what admins supply today: a name, information,
// cycling-off and supplement guidance (strengths, categories, a subtitle
// and references are not stored yet; admin editing arrives with V7). So
// the row's one line is the information's first sentence, and the filter
// chips are All and In my cycles.
import { inMassUnit, massUnit } from "@/lib/alpha/format";
import { doseAt } from "@/lib/cycles/rules";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleStatus } from "@/lib/cycles/schedule";
import { currentActive } from "@/lib/cycles/screens";
import { drawDisplay } from "@/lib/doses/rules";
import { formatDate, formatMonthDay } from "@/lib/format";
import { concentrationOf, type Mixture } from "@/lib/mixtures/rules";
import { localDateOf, toInstant, type InstantInput } from "@/lib/schedule/zone";

/** Library dates are shown in the business zone. */
export const LIBRARY_TIME_ZONE = "America/Toronto";

export const IN_YOUR_CYCLE = "In your cycle";
export const LIBRARY_EMPTY = "No peptides in the library yet.";
export const LIBRARY_EMPTY_BODY = "Alpha PR Labs adds research summaries here. Check back later.";
export const NOT_IN_CYCLES = "None of your current cycles use a library peptide.";
export const noMatch = (query: string) => `No peptides match “${query}”.`;
export const SECTION_EMPTY = {
  summary: "No research summary supplied yet.",
  cyclingOff: "No cycling-off guidance supplied for this peptide.",
  supplement: "No supplement guidance supplied for this peptide.",
} as const;

/** The longest one-line description before it is cut at a word. */
const DESCRIPTION_LIMIT = 90;

/**
 * The row's one line: the information's first sentence (or line), cut at a
 * word with "…" past DESCRIPTION_LIMIT characters; "" when there is none.
 */
export function oneLine(information: string): string {
  const first = information.trim().split(/\n+/)[0]?.trim() ?? "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
  const chars = [...sentence];
  if (chars.length <= DESCRIPTION_LIMIT) return sentence;
  const cut = chars.slice(0, DESCRIPTION_LIMIT).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > DESCRIPTION_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·-]+$/, "")}…`;
}

/** "3 peptides · updated Sep 18" (the newest entry's update), or "No peptides yet". */
export function libraryMeta(peptides: readonly { updatedAt: string }[]): string {
  if (!peptides.length) return "No peptides yet";
  const newest = peptides.map((peptide) => peptide.updatedAt).sort().at(-1)!;
  return `${peptides.length} ${peptides.length === 1 ? "peptide" : "peptides"} · updated ${formatMonthDay(newest, { timeZone: LIBRARY_TIME_ZONE })}`;
}

/** "Updated Aug 20, 2026" (R12). */
export const updatedLabel = (updatedAt: string) => `Updated ${formatDate(updatedAt, { timeZone: LIBRARY_TIME_ZONE })}`;

/** The researcher's cycles that are running or still to come (an ended cycle no longer counts). */
export function currentCycles(cycles: readonly CycleRecord[], now: InstantInput): CycleRecord[] {
  return cycles.filter((cycle) => {
    const revision = cycle.revisions.at(-1);
    return revision && revision.plans.length > 0 && cycleStatus(revision, now) !== "Ended";
  });
}

/** Peptide ids the researcher's current cycles use ("In your cycle"). */
export function peptidesInCycles(cycles: readonly CycleRecord[], now: InstantInput): Set<string> {
  return new Set(currentCycles(cycles, now).flatMap((cycle) => cycle.revisions.at(-1)!.plans.map((plan) => plan.peptideId)));
}

export type LibraryRow = { id: string; name: string; description: string; inCycle: boolean; search: string };

/**
 * R11's rows: name order, with what the search matches (name and
 * description, lower-cased). The description is the entry's short
 * description (A9, V7), or the research summary's first sentence when it
 * has none.
 */
export function libraryRows(
  peptides: readonly { id: string; name: string; information: string; shortDescription?: string }[],
  inCycles: ReadonlySet<string>,
): LibraryRow[] {
  return peptides.map((peptide) => {
    const description = peptide.shortDescription?.trim() || oneLine(peptide.information);
    return { id: peptide.id, name: peptide.name, description, inCycle: inCycles.has(peptide.id), search: `${peptide.name}\n${description}`.toLowerCase() };
  });
}

export type LibraryFilter = "all" | "mine";

/** The rows a filter and a search show. */
export function filterRows(rows: readonly LibraryRow[], filter: LibraryFilter, query: string): LibraryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => (filter === "all" || row.inCycle) && (!q || row.search.includes(q)));
}

/** A reading of R12's Now block: the value in large type and its unit in mono. */
export type Reading = { value: string; unit: string };

export type YourMix = {
  /** The cycle it comes from. */
  cycleId: string;
  cycleName: string;
  /** "Your mix · 10 mg + 2 mL", or null when the plan has no saved mix. */
  mix: string | null;
  /** "30-unit syringe". */
  syringe: string | null;
  strength: Reading | null;
  /** The plan's current dose (today's phase, else the next, else the last). */
  dose: Reading | null;
  /** Syringe units for that dose, never rounded; null when it can't be calculated. */
  draw: Reading | null;
};

/**
 * R12's "Your mix": the peptide's plan in the researcher's current cycles
 * (a running cycle before one still to come), with its saved mixture and
 * dose through the calculator. Null when no current cycle uses it.
 */
export function yourMix(peptideId: string, cycles: readonly CycleRecord[], mixtures: readonly Mixture[], now: InstantInput): YourMix | null {
  const current = currentCycles(cycles, now)
    .map((cycle) => ({ cycle, revision: cycle.revisions.at(-1)! }))
    .filter(({ revision }) => revision.plans.some((plan) => plan.peptideId === peptideId))
    .sort((a, b) => Number(cycleStatus(a.revision, now) === "Upcoming") - Number(cycleStatus(b.revision, now) === "Upcoming"));
  const found = current[0];
  if (!found) return null;
  const { cycle, revision } = found;
  const plan = revision.plans.find((p) => p.peptideId === peptideId)!;
  const today = localDateOf(toInstant(now), revision.timeZone);
  const active = currentActive(plan.phases, today);
  const on = active ? (today < active.start ? active.start : today > active.end ? active.end : today) : null;
  const doseMg = active && on ? doseAt(active, on) : null;
  const dose = doseMg ? { value: inMassUnit(doseMg, massUnit(doseMg)), unit: massUnit(doseMg) } : null;
  const mixture = mixtures.find((m) => m.planIds.includes(plan.planId)) ?? null;
  if (!mixture) return { cycleId: cycle.id, cycleName: cycle.name, mix: null, syringe: null, strength: null, dose, draw: null };
  const { setup } = mixture;
  const draw = doseMg ? drawDisplay(setup, doseMg) : null;
  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    mix: `${setup.vialMg} mg + ${setup.liquidMl} mL`,
    syringe: `${setup.syringe}-unit syringe`,
    strength: { value: concentrationOf(setup), unit: "mg/mL" },
    dose,
    draw: draw?.kind === "units" ? { value: draw.units, unit: "units" } : null,
  };
}
