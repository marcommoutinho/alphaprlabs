// R9 Progress: what the screen shows (the prototype's progress view). Pure:
// built from the researcher's cycles, their recorded doses and check-ins.
//
// One cycle is shown at a time (the cycle picker): its goal and baseline, and
// "Last 14 days" in that cycle's zone, today first. Each day shows the day's
// check-in (or that there was none: a gap, not a zero), its measurement, the
// selected cycle's phase for each peptide that day, and every dose actually
// recorded that day across all the researcher's cycles, each dated by its
// actual time in its own occurrence's zone (as Today and the cycle history
// show it). Observations are only shown beside the doses: nothing here links
// a result to a compound.
import { formatDate, formatDay, formatMonthDay } from "@/lib/format";
import type { CycleRecord } from "@/lib/cycles/rules";
import { doseAt } from "@/lib/cycles/rules";
import { cycleOccurrences, cycleSpan, cycleStatus, type CycleStatus } from "@/lib/cycles/schedule";
import { planPeptides, type RecordedConfirmation, type ViewPeptides } from "@/lib/cycles/views";
import { formatLocalTime, type InstantInput, localDateOf, toInstant, wallClock } from "@/lib/schedule/zone";
import { effectsLine, formTitle, HISTORY_DAYS, NO_CHECK_IN, NO_DOSES, saveLabel, SPARSE } from "./rules";
import type { CheckIn } from "./service";

/** Today's check-in as the form starts from it. */
export type FormStart = {
  version: number;
  feeling: number;
  effects: string[];
  note: string;
  measurement: { name: string; value: string; unit: string } | null;
};

export type HistoryDay = {
  /** YYYY-MM-DD */
  day: string;
  /** "Today" or "Fri Sep 25" */
  label: string;
  today: boolean;
  /** "Compound A: 0.4 mg · Compound B: break" for the selected cycle, or "" outside it. */
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
  /** "Doses: Compound A 0.4 mg, …", or that none were recorded. */
  doses: string;
};

export type ProgressView =
  | { kind: "no-cycle" }
  | {
      kind: "ready";
      cycles: { id: string; name: string }[];
      cycle: {
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
      timeZone: string;
      form: { cycleId: string; day: string; title: string; saveLabel: string; start: FormStart | null };
      /** The prototype's note while fewer than 3 check-ins exist, else "". */
      sparse: string;
      /** Today first. */
      rows: HistoryDay[];
    };

export type ProgressInput = {
  /** Newest first (listCycles). */
  cycles: readonly CycleRecord[];
  /** The cycle asked for (?cycle=), if any. */
  selectedId: string | null;
  /** At least the days shown (see progressWindow). */
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

/** The cycle shown: the one asked for, else the newest current one (Active or In break), else the newest. */
export function selectedCycle(cycles: readonly CycleRecord[], selectedId: string | null, now: InstantInput): CycleRecord | null {
  const asked = selectedId ? cycles.find((c) => c.id === selectedId.toLowerCase()) : undefined;
  if (asked) return asked;
  return cycles.find((c) => ["Active", "In break"].includes(cycleStatus(current(c), now))) ?? cycles[0] ?? null;
}

/** The days shown for a cycle: today in its zone and the 13 before (what to read). */
export function progressWindow(cycle: CycleRecord, now: InstantInput): { from: string; to: string; timeZone: string } {
  const timeZone = current(cycle).timeZone;
  const to = localDateOf(toInstant(now), timeZone);
  return { from: addDay(to, -(HISTORY_DAYS - 1)), to, timeZone };
}

/** "Compound A: 0.4 mg · Compound B: break": each plan's phase on `day` (the current plan keeps past phases as they were). */
export function phaseLine(cycle: CycleRecord, day: string, peptides: ViewPeptides): string {
  return current(cycle)
    .plans.map((plan) => {
      const phase = plan.phases.find((p) => p.start <= day && p.end >= day);
      if (!phase) return null;
      const name = peptides.get(plan.peptideId)?.name ?? "Unknown peptide";
      return `${name}: ${phase.kind === "break" ? "break" : `${doseAt(phase, day)} mg`}`;
    })
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** Every recorded dose by the local day of its actual time, in its own occurrence's zone, oldest first within a day. */
export function dosesByDay(
  cycles: readonly CycleRecord[],
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>,
  peptides: ViewPeptides,
  days: { from: string; to: string },
): Map<string, string[]> {
  const found: { day: string; at: number; text: string }[] = [];
  // A day's instants lie within 14 hours of UTC midnight either side (the widest zone offsets).
  const earliest = Date.parse(`${days.from}T00:00:00Z`) - 15 * 3_600_000;
  const latest = Date.parse(`${addDay(days.to, 1)}T00:00:00Z`) + 15 * 3_600_000;
  for (const cycle of cycles) {
    const records = (confirmations.get(cycle.id) ?? []).filter((r) => {
      const at = toInstant(r.actualAt).epochMilliseconds;
      return at >= earliest && at < latest;
    });
    if (!records.length) continue;
    const zones = new Map(cycleOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? []).map((o) => [o.key, o.timeZone]));
    const planOf = planPeptides(cycle);
    for (const record of records) {
      const timeZone = zones.get(record.key) ?? current(cycle).timeZone;
      const day = localDateOf(toInstant(record.actualAt), timeZone);
      if (day < days.from || day > days.to) continue;
      const name = peptides.get(planOf.get(record.key.split(":")[0]) ?? "")?.name ?? "Unknown peptide";
      const amount = record.amountMg ?? "";
      found.push({ day, at: toInstant(record.actualAt).epochMilliseconds, text: amount ? `${name} ${amount} mg` : name });
    }
  }
  const byDay = new Map<string, string[]>();
  for (const dose of found.sort((a, b) => a.at - b.at)) byDay.set(dose.day, [...(byDay.get(dose.day) ?? []), dose.text]);
  return byDay;
}

/** Everything R9 shows as of `now`. */
export function progressView(input: ProgressInput): ProgressView {
  const cycle = selectedCycle(input.cycles, input.selectedId, input.now);
  if (!cycle) return { kind: "no-cycle" };
  const { from, to: today, timeZone } = progressWindow(cycle, input.now);
  const byDay = new Map(input.checkIns.map((c) => [c.day, c]));
  const doses = dosesByDay(input.cycles, input.confirmations, input.peptides, { from, to: today });
  const existing = byDay.get(today) ?? null;
  const span = cycleSpan(current(cycle));

  const rows = Array.from({ length: HISTORY_DAYS }, (_, i): HistoryDay => {
    const day = addDay(today, -i);
    const checkIn = byDay.get(day);
    const dayDoses = doses.get(day) ?? [];
    return {
      day,
      label: i === 0 ? "Today" : formatDay(day),
      today: i === 0,
      phase: phaseLine(cycle, day, input.peptides),
      feeling: checkIn?.feeling ?? null,
      feelLabel: checkIn ? `${checkIn.feeling}/5` : NO_CHECK_IN,
      effects: checkIn ? effectsLine(checkIn.effects) : "",
      note: checkIn?.note ?? "",
      measure: checkIn?.measurement ? `${checkIn.measurement.name} ${checkIn.measurement.value} ${checkIn.measurement.unit}` : "",
      doses: dayDoses.length ? `Doses: ${dayDoses.join(", ")}` : NO_DOSES,
    };
  });

  return {
    kind: "ready",
    cycles: input.cycles.map((c) => ({ id: c.id, name: c.name })),
    cycle: {
      id: cycle.id,
      name: cycle.name,
      goal: cycle.goal || "—",
      baseline: cycle.baseline || "not set yet",
      hasBaseline: cycle.baseline !== "",
      status: cycleStatus(current(cycle), input.now),
      dates: `${formatMonthDay(span.start)} – ${formatDate(span.end)}`,
      editHref: `/app/cycles/${cycle.id}/edit`,
    },
    timeZone,
    form: {
      cycleId: cycle.id,
      day: today,
      title: formTitle(existing ? formatLocalTime(wallClock(toInstant(existing.updatedAt), timeZone)) : null),
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
