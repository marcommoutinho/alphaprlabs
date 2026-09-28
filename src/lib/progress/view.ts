// R9 Progress: what the screen shows (the prototype's progress view). Pure:
// built from the researcher's cycles, their recorded doses and check-ins.
//
// One axis of days (Marco, 2026-09-26): "Last 14 days" are America/Toronto
// calendar days, today first, as a check-in's day always is. Each day shows
// the day's check-in, or that there was none (a gap, not a zero), and its
// measurement.
//
// A check-in needs no cycle. With a cycle selected (the cycle picker), each
// day also shows:
//   * that cycle's phases for each peptide in force during that Toronto day,
//     across every revision (phasesDuring): resolved by instant, as the
//     cycle's doses are, with each revision's dates in its own zone, so a
//     dose always sits beside the phase that planned it, and a plan a later
//     edit removed still shows on its earlier days. A day during which the
//     plan changes (an edit's seam falls inside it, or another zone's dates
//     turn over during it) shows each value in time order: "0.4 mg → 0.6 mg";
//   * every dose actually recorded that day across all the researcher's
//     cycles (as the prototype does), placed by the Toronto date of its
//     actual time. For a cycle in Toronto's zone that is the dose's own local
//     day (as Today and the cycle history date it); a dose from a cycle in
//     another zone is placed by its Toronto day, so doses and check-ins share
//     one axis.
// With no cycle (none exists, or "No cycle" is picked) the history shows
// check-ins only. Observations are only shown beside the doses: nothing here
// links a result to a compound.
import { formatDate, formatDay, formatMonthDay } from "@/lib/format";
import type { CycleRecord } from "@/lib/cycles/rules";
import { doseAt } from "@/lib/cycles/rules";
import { cycleSpan, cycleStatus, type CycleStatus, phasesDuring } from "@/lib/cycles/schedule";
import { planPeptides, type RecordedConfirmation, type ViewPeptides } from "@/lib/cycles/views";
import { formatLocalTime, type InstantInput, toInstant, wallClock } from "@/lib/schedule/zone";
import { checkInDay, effectsLine, formTitle, HISTORY_DAYS, NO_CHECK_IN, NO_DOSES, PROGRESS_TIME_ZONE, saveLabel, SPARSE } from "./rules";
import type { CheckIn } from "./service";

/** `?cycle=none`: no cycle, check-ins only. */
export const NO_CYCLE_PARAM = "none";

/** Today's check-in as the form starts from it. */
export type FormStart = {
  version: number;
  feeling: number;
  effects: string[];
  note: string;
  measurement: { name: string; value: string; unit: string } | null;
};

export type HistoryDay = {
  /** YYYY-MM-DD, a Toronto day. */
  day: string;
  /** "Today" or "Fri Sep 25" */
  label: string;
  today: boolean;
  /** "Compound A: 0.4 mg · Compound B: break" for the selected cycle, or "" (outside it, or no cycle). */
  phase: string;
  /** 1–5, or null without a check-in. */
  feeling: number | null;
  /** "4/5", or that there was no check-in. */
  feelLabel: string;
  /** "Mild headache, Nausea", or "". */
  effects: string;
  note: string;
  /** "Weight 82.4 kg", or "". */
  measure: string;
  /** "Doses: Compound A 0.4 mg, …" or that none were recorded; null with no cycle selected (check-ins only). */
  doses: string | null;
};

export type ProgressCycle = {
  id: string;
  name: string;
  goal: string;
  /** The baseline, or "not set yet". */
  baseline: string;
  hasBaseline: boolean;
  status: CycleStatus;
  /** "Sep 11 – Oct 9, 2026" */
  dates: string;
  editHref: string;
};

export type ProgressView = {
  /** The researcher's cycles for the picker, newest first (empty: none yet). */
  cycles: { id: string; name: string }[];
  /** The selected cycle, or null (check-ins only). */
  cycle: ProgressCycle | null;
  form: { day: string; title: string; saveLabel: string; start: FormStart | null };
  /** The prototype's note while fewer than 3 check-ins exist, else "". */
  sparse: string;
  /** Today first. */
  rows: HistoryDay[];
};

export type ProgressInput = {
  /** Newest first (listCycles). */
  cycles: readonly CycleRecord[];
  /** `?cycle=`: a cycle id, NO_CYCLE_PARAM, or null (the default). */
  selectedId: string | null;
  /** At least the days shown (progressWindow). */
  checkIns: readonly CheckIn[];
  /** How many check-ins exist in all. */
  total: number;
  /** Recorded doses by cycle id (confirmationsByCycle). */
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>;
  peptides: ViewPeptides;
  now: InstantInput;
};

const addDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const current = (cycle: CycleRecord) => cycle.revisions[cycle.revisions.length - 1];

/**
 * The cycle shown: the one asked for; none for NO_CYCLE_PARAM; by default the
 * newest current one (Active or In break), else none (between cycles).
 */
export function selectedCycle(cycles: readonly CycleRecord[], selectedId: string | null, now: InstantInput): CycleRecord | null {
  if (selectedId === NO_CYCLE_PARAM) return null;
  const asked = selectedId ? cycles.find((c) => c.id === selectedId.toLowerCase()) : undefined;
  if (asked) return asked;
  return cycles.find((c) => ["Active", "In break"].includes(cycleStatus(current(c), now))) ?? null;
}

/** The days shown: today in Toronto and the 13 before (what to read). */
export function progressWindow(now: InstantInput): { from: string; to: string } {
  const to = checkInDay(toInstant(now).toString(), PROGRESS_TIME_ZONE);
  return { from: addDay(to, -(HISTORY_DAYS - 1)), to };
}

/**
 * "Compound A: 0.4 mg · Compound B: break": each plan's phases in force
 * during the Toronto `day`, across the cycle's revisions; a change during the
 * day reads "Compound A: 0.4 mg → 0.6 mg".
 */
export function phaseLine(cycle: CycleRecord, day: string, peptides: ViewPeptides): string {
  return phasesDuring(cycle.revisions, day, PROGRESS_TIME_ZONE)
    .map(({ peptideId, parts }) => {
      const name = peptides.get(peptideId)?.name ?? "Unknown peptide";
      const values = parts.map(({ phase, date }) => (phase.kind === "break" ? "break" : `${doseAt(phase, date)} mg`));
      return `${name}: ${values.filter((value, i) => value !== values[i - 1]).join(" → ")}`;
    })
    .join(" · ");
}

/** Every recorded dose by the Toronto day of its actual time (see the header), oldest first within a day. */
export function dosesByDay(
  cycles: readonly CycleRecord[],
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>,
  peptides: ViewPeptides,
  days: { from: string; to: string },
): Map<string, string[]> {
  const found: { day: string; at: number; text: string }[] = [];
  for (const cycle of cycles) {
    const planOf = planPeptides(cycle);
    for (const record of confirmations.get(cycle.id) ?? []) {
      if (record.skipped) continue;
      const at = toInstant(record.actualAt);
      const day = checkInDay(at.toString(), PROGRESS_TIME_ZONE);
      if (day < days.from || day > days.to) continue;
      const name = peptides.get(planOf.get(record.key.split(":")[0]) ?? "")?.name ?? "Unknown peptide";
      found.push({ day, at: at.epochMilliseconds, text: record.amountMg ? `${name} ${record.amountMg} mg` : name });
    }
  }
  const byDay = new Map<string, string[]>();
  for (const dose of found.sort((a, b) => a.at - b.at)) byDay.set(dose.day, [...(byDay.get(dose.day) ?? []), dose.text]);
  return byDay;
}

function cycleOf(cycle: CycleRecord, now: InstantInput): ProgressCycle {
  const span = cycleSpan(current(cycle));
  return {
    id: cycle.id,
    name: cycle.name,
    goal: cycle.goal || "—",
    baseline: cycle.baseline || "not set yet",
    hasBaseline: cycle.baseline !== "",
    status: cycleStatus(current(cycle), now),
    dates: `${formatMonthDay(span.start)} – ${formatDate(span.end)}`,
    editHref: `/app/cycles/${cycle.id}/edit`,
  };
}

/** Everything R9 shows as of `now`. */
export function progressView(input: ProgressInput): ProgressView {
  const cycle = selectedCycle(input.cycles, input.selectedId, input.now);
  const { from, to: today } = progressWindow(input.now);
  const byDay = new Map(input.checkIns.map((c) => [c.day, c]));
  const doses = cycle ? dosesByDay(input.cycles, input.confirmations, input.peptides, { from, to: today }) : null;
  const existing = byDay.get(today) ?? null;

  const rows = Array.from({ length: HISTORY_DAYS }, (_, i): HistoryDay => {
    const day = addDay(today, -i);
    const checkIn = byDay.get(day);
    const dayDoses = doses?.get(day) ?? [];
    return {
      day,
      label: i === 0 ? "Today" : formatDay(day),
      today: i === 0,
      phase: cycle ? phaseLine(cycle, day, input.peptides) : "",
      feeling: checkIn?.feeling ?? null,
      feelLabel: checkIn ? `${checkIn.feeling}/5` : NO_CHECK_IN,
      effects: checkIn ? effectsLine(checkIn.effects) : "",
      note: checkIn?.note ?? "",
      measure: checkIn?.measurement ? `${checkIn.measurement.name} ${checkIn.measurement.value} ${checkIn.measurement.unit}` : "",
      doses: doses === null ? null : dayDoses.length ? `Doses: ${dayDoses.join(", ")}` : NO_DOSES,
    };
  });

  return {
    cycles: input.cycles.map((c) => ({ id: c.id, name: c.name })),
    cycle: cycle ? cycleOf(cycle, input.now) : null,
    form: {
      day: today,
      title: formTitle(existing ? formatLocalTime(wallClock(toInstant(existing.updatedAt), PROGRESS_TIME_ZONE)) : null),
      saveLabel: saveLabel(existing !== null),
      start: existing
        ? {
            version: existing.version,
            feeling: existing.feeling,
            effects: existing.effects,
            note: existing.note,
            measurement: existing.measurement
              ? { name: existing.measurement.name, value: existing.measurement.value, unit: existing.measurement.unit }
              : null,
          }
        : null,
    },
    sparse: input.total < 3 ? SPARSE : "",
    rows,
  };
}
