// Design v3 R5 Progress (phone) and D3 (laptop): what the screen shows. Pure:
// built from the researcher's cycles, recorded doses, skips and check-ins.
//
// Every day is an America/Toronto calendar day, as a check-in's day always
// is (Marco, 2026-09-26: one axis). The range is the segmented control's:
//   7d / 30d  the last 7 or 30 days, today last;
//   cycle     the selected cycle from its start to its end (or today, while
//             it runs), with the 7 days before it as the "before" context
//             (hatched on the charts). Without a cycle that has started it
//             falls back to 30 days.
// Gaps stay gaps: a day without a check-in has no point (the line breaks),
// never a zero. A check-in needs no cycle; without one the screen shows the
// check-ins only (no dose tracks, no adherence). Observations are only shown
// beside the doses: nothing here links a result to a compound.
import { Exact, formatAmount } from "@/lib/calculator/decimal";
import { adherence, adherenceCount } from "@/lib/cycles/adherence";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleSpan, cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { planPeptides, type RecordedConfirmation, type ViewPeptides } from "@/lib/cycles/views";
import { clock12, massLabel } from "@/lib/alpha/format";
import { addDaysToDate, daysBetween, wallOf } from "@/lib/doses/rules";
import { formatDay, formatMonthDay } from "@/lib/format";
import { type InstantInput, toInstant } from "@/lib/schedule/zone";
import { checkInDay, type Effect, effectLabel, FEELING_WORDS, formEffects, NONE, OTHER, PROGRESS_TIME_ZONE, SPARSE } from "./rules";
import type { CheckIn } from "./service";
import { dosesByDay, NO_CYCLE_PARAM, phaseLine, selectedCycle } from "./view";

export { NO_CYCLE_PARAM };

// ── The range ───────────────────────────────────────────────────────────────

export const RANGES = ["7d", "30d", "cycle"] as const;
export type ProgressRange = (typeof RANGES)[number];
export const DEFAULT_RANGE: ProgressRange = "30d";
/** Days shown before a cycle's start in the "Cycle" range. */
export const LEAD_IN_DAYS = 7;

/** `?range=`: one of RANGES, else null (the default). */
export const readRange = (value: unknown): ProgressRange | null =>
  typeof value === "string" && (RANGES as readonly string[]).includes(value) ? (value as ProgressRange) : null;

export type RangeWindow = {
  range: ProgressRange;
  /** First and last day shown (YYYY-MM-DD, Toronto). */
  from: string;
  to: string;
  /** The days the averages and tiles count: the whole range, or the cycle's own days for "cycle". */
  countFrom: string;
  /** Today (Toronto). */
  today: string;
};

const current = (cycle: CycleRecord) => cycle.revisions[cycle.revisions.length - 1];

/** Today in Toronto. */
export const progressToday = (now: InstantInput) => checkInDay(toInstant(now).toString(), PROGRESS_TIME_ZONE);

/** The days a range covers (see the header). */
export function rangeWindow(cycle: CycleRecord | null, asked: ProgressRange | null, now: InstantInput): RangeWindow {
  const today = progressToday(now);
  const span = cycle ? cycleSpan(current(cycle)) : null;
  const range = asked ?? DEFAULT_RANGE;
  if (range === "cycle" && span && span.start <= today) {
    const to = span.end < today ? span.end : today;
    return { range, from: addDaysToDate(span.start, -LEAD_IN_DAYS), to, countFrom: span.start, today };
  }
  const days = range === "7d" ? 7 : 30;
  const from = addDaysToDate(today, 1 - days);
  return { range: range === "cycle" ? DEFAULT_RANGE : range, from, to: today, countFrom: from, today };
}

/** Every day from `from` to `to`, oldest first. */
export const daysOf = (from: string, to: string): string[] =>
  Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => addDaysToDate(from, i));

/** A day's position on a chart of `n` days: 0 (first) to 1 (last); one day sits in the middle. */
export const dayX = (index: number, n: number) => (n <= 1 ? 0.5 : index / (n - 1));

// ── Feeling ─────────────────────────────────────────────────────────────────

export type FeelingChange = {
  direction: "up" | "down" | "flat";
  /** "Up 0.6", "Down 0.3", "No change" */
  text: string;
  /** "first week to last", or "first 3 days to last" in a short range. */
  caption: string;
};

const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** The average feeling of the check-ins on `days` ("3.8"), or null without any. */
export function feelingAverage(byDay: ReadonlyMap<string, number>, days: readonly string[]): string | null {
  const values = days.flatMap((day) => (byDay.has(day) ? [byDay.get(day)!] : []));
  return values.length ? oneDecimal(mean(values)) : null;
}

/**
 * The change from the first week to the last (the average of each window's
 * check-ins): 7-day windows over 14 days or more, else half the days each.
 * Null when either window has no check-in: a gap is not a zero.
 */
export function feelingChange(byDay: ReadonlyMap<string, number>, days: readonly string[]): FeelingChange | null {
  const k = days.length >= 14 ? 7 : Math.floor(days.length / 2);
  if (k < 1) return null;
  const first = days.slice(0, k).flatMap((day) => (byDay.has(day) ? [byDay.get(day)!] : []));
  const last = days.slice(days.length - k).flatMap((day) => (byDay.has(day) ? [byDay.get(day)!] : []));
  if (!first.length || !last.length) return null;
  const diff = Math.round((mean(last) - mean(first)) * 10) / 10;
  const caption = k === 7 ? "first week to last" : `first ${k} day${k === 1 ? "" : "s"} to last`;
  if (diff === 0) return { direction: "flat", text: "No change", caption };
  return { direction: diff > 0 ? "up" : "down", text: `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff).toFixed(1)}`, caption };
}

/** One point per day: the day's feeling, or null (a gap). */
export type FeelingPoint = { day: string; x: number; feeling: number | null };

export function feelingPoints(byDay: ReadonlyMap<string, number>, days: readonly string[]): FeelingPoint[] {
  return days.map((day, i) => ({ day, x: dayX(i, days.length), feeling: byDay.get(day) ?? null }));
}

/**
 * How much of the chart is before the cycle started, 0–1 (the hatched
 * area): up to the cycle's first day's position. Null without a cycle, or
 * when the range starts on or after its start.
 */
export function preCycleFraction(days: readonly string[], cycleStart: string | null): number | null {
  if (!cycleStart || !days.length || days[0] >= cycleStart) return null;
  const index = days.indexOf(cycleStart);
  if (index < 0) return 1;
  return dayX(index, days.length);
}

// ── Dose tracks ─────────────────────────────────────────────────────────────

export type DoseDot = { x: number; pending: boolean; label: string };
export type DoseTrack = { key: string; name: string; dots: DoseDot[] };

/**
 * Each peptide of the cycle as a lane of dots: a dose taken at its time on
 * its Toronto day, and today's doses still to take (not skipped) hollow at
 * their planned time.
 */
export function doseTracks(
  cycle: CycleRecord,
  confirmations: readonly RecordedConfirmation[],
  peptides: ViewPeptides,
  days: readonly string[],
  now: InstantInput,
): DoseTrack[] {
  if (!days.length) return [];
  const today = progressToday(now);
  const first = days[0];
  const n = days.length;
  const peptideOf = planPeptides(cycle);
  const lanes = new Map<string, DoseTrack>();
  const place = (at: string) => {
    const wall = wallOf(at, PROGRESS_TIME_ZONE);
    const index = daysBetween(first, wall.slice(0, 10));
    if (index < 0 || index >= n) return null;
    const minutes = Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
    const x = n <= 1 ? minutes / 1440 : (index + minutes / 1440 - 0.5) / (n - 1);
    return { x: Math.min(1, Math.max(0, x)), wall };
  };
  for (const [planId, occurrences] of planOccurrences(cycle.revisions, confirmations)) {
    const peptideId = peptideOf.get(planId) ?? "";
    const name = peptides.get(peptideId)?.name ?? "Unknown peptide";
    const lane = lanes.get(peptideId) ?? { key: peptideId, name, dots: [] };
    for (const o of occurrences) {
      if (o.skipped) continue;
      const taken = o.actualAt !== null;
      if (!taken && checkInDay(o.scheduledAt, PROGRESS_TIME_ZONE) !== today) continue;
      if (!taken && o.localDate < today) continue;
      const spot = place(taken ? o.actualAt! : o.scheduledAt);
      if (!spot) continue;
      const amount = confirmations.find((c) => c.key === o.key)?.amountMg ?? o.doseMg;
      const when = `${formatMonthDay(spot.wall.slice(0, 10))} ${clock12(spot.wall.slice(11, 16))}`;
      lane.dots.push({ x: spot.x, pending: !taken, label: `${name} · ${massLabel(amount)} · ${taken ? when : `due ${clock12(spot.wall.slice(11, 16))}`}` });
    }
    lanes.set(peptideId, lane);
  }
  return [...lanes.values()]
    .filter((lane) => lane.dots.length)
    .map((lane) => ({ ...lane, dots: lane.dots.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Measurement ─────────────────────────────────────────────────────────────

export type MeasurePoint = { day: string; x: number; value: number };

export type MeasureCard = {
  /** "Weight" */
  name: string;
  unit: string;
  /** The latest value, exact ("81.4"), and its day. */
  latest: string;
  latestDay: string;
  /** "8 entries" */
  entries: string;
  /** "Down 2.3 kg" since `since`, or null with one entry. */
  change: { direction: "up" | "down" | "flat"; text: string; since: string } | null;
  points: MeasurePoint[];
  /** The highest and lowest values shown, for the chart's labels ("84 kg"). */
  max: string;
  min: string;
};

/**
 * The measurement card: Weight when any was measured in the range, else the
 * most recent measurement's kind, in the unit of its latest entry (entries in
 * another unit are left out, never converted). The change is from the
 * baseline: the last entry on or before the cycle's start, else the first
 * one in the range. Null when nothing was measured.
 */
export function measureCard(checkIns: readonly CheckIn[], days: readonly string[], cycleStart: string | null): MeasureCard | null {
  const inRange = checkIns.filter((c) => c.measurement && days.length && c.day >= days[0] && c.day <= days[days.length - 1]).sort((a, b) => a.day.localeCompare(b.day));
  if (!inRange.length) return null;
  const name = inRange.some((c) => c.measurement!.name === "Weight") ? "Weight" : inRange[inRange.length - 1].measurement!.name;
  const named = inRange.filter((c) => c.measurement!.name === name);
  const unit = named[named.length - 1].measurement!.unit;
  const entries = named.filter((c) => c.measurement!.unit === unit);
  const latest = entries[entries.length - 1];
  const before = cycleStart ? entries.filter((c) => c.day <= cycleStart) : [];
  const baseline = before.length ? before[before.length - 1] : entries[0];
  const n = days.length;
  const values = entries.map((c) => new Exact(c.measurement!.value));
  const max = values.reduce((a, b) => (b.greaterThan(a) ? b : a));
  const min = values.reduce((a, b) => (b.lessThan(a) ? b : a));
  let change: MeasureCard["change"] = null;
  if (baseline !== latest) {
    const diff = new Exact(latest.measurement!.value).minus(baseline.measurement!.value);
    change = {
      direction: diff.isZero() ? "flat" : diff.isPositive() ? "up" : "down",
      text: diff.isZero() ? "No change" : `${diff.isPositive() ? "Up" : "Down"} ${formatAmount(diff.abs())} ${unit}`,
      since: `since ${formatMonthDay(baseline.day)}`,
    };
  }
  return {
    name,
    unit,
    latest: formatAmount(new Exact(latest.measurement!.value)),
    latestDay: latest.day,
    entries: `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
    change,
    points: entries.map((c) => ({ day: c.day, x: dayX(daysBetween(days[0], c.day), n), value: Number(c.measurement!.value) })),
    max: `${formatAmount(max)} ${unit}`,
    min: `${formatAmount(min)} ${unit}`,
  };
}

// ── Unwanted effects and check-in rows ──────────────────────────────────────

/** The effects a check-in reports, as shown ("Headache", "Other: dizzy"); "None" is no effect. */
export function reportedEffects(checkIn: Pick<CheckIn, "effects" | "effectsOther">): string[] {
  return checkIn.effects
    .map((stored) => effectLabel(stored))
    .filter((label) => label !== NONE)
    .map((label) => (label === OTHER && checkIn.effectsOther.trim() ? `Other: ${checkIn.effectsOther.trim()}` : label));
}

export type EffectRow = { label: string; days: number; count: string; dates: string };

/** Each unwanted effect reported in the range: on how many days, and when ("Sep 15 · Sep 24", or "Sep 1 – Sep 24" past 3 days). */
export function effectRows(checkIns: readonly CheckIn[]): EffectRow[] {
  const byLabel = new Map<string, string[]>();
  for (const c of [...checkIns].sort((a, b) => a.day.localeCompare(b.day)))
    for (const label of new Set(reportedEffects(c))) byLabel.set(label, [...(byLabel.get(label) ?? []), c.day]);
  return [...byLabel]
    .map(([label, days]) => ({
      label,
      days: days.length,
      count: `${days.length} day${days.length === 1 ? "" : "s"}`,
      dates: days.length <= 3 ? days.map((d) => formatMonthDay(d)).join(" · ") : `${formatMonthDay(days[0])} – ${formatMonthDay(days[days.length - 1])}`,
    }))
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label));
}

export type CheckInRow = {
  day: string;
  /** "Thu Sep 24" */
  date: string;
  today: boolean;
  feeling: number;
  /** "4 · Good" */
  feelingText: string;
  /** "Headache, Other: dizzy", or "". */
  effects: string;
  note: string;
  /** "Weight 82.4 kg", or "". */
  measure: string;
  /** "Weight" and "82.4 kg" (D3's column), or "". */
  measureName: string;
  measureValue: string;
  /** The cycle's phases that day ("Compound A: 0.4 mg · Compound B: break"), or "" (no cycle, or outside it). */
  phase: string;
  /** "Compound A 0.45 mg" doses recorded that day, or "No doses recorded this day"; null without a cycle. */
  doses: string | null;
};

// ── The screen ──────────────────────────────────────────────────────────────

/** Today's check-in as the edit sheet starts from it. */
export type FormStart = {
  version: number;
  feeling: number;
  /** v3 chips (a check-in stored with the earlier chips is mapped: formEffects). */
  effects: Effect[];
  effectsOther: string;
  note: string;
  measurement: { name: string; value: string; unit: string } | null;
};

export type ProgressScreen = {
  range: ProgressRange;
  /** The ranges offered: "Cycle" only with a started cycle. */
  ranges: ProgressRange[];
  from: string;
  to: string;
  today: string;
  /** The researcher's cycles for the picker, newest first. */
  cycles: { id: string; name: string }[];
  /** The selected cycle's id, or null (check-ins only). */
  cycleId: string | null;
  /** "Recomp Fall 26 · day 24", "… · ended Sep 24", "… · starts Oct 1", or "Check-ins only". */
  header: string;
  feeling: {
    /** "Feeling · 30-day average" */
    label: string;
    /** "Aug 30 – Sep 28" */
    rangeLabel: string;
    average: string | null;
    change: FeelingChange | null;
    points: FeelingPoint[];
    preCycle: number | null;
    /** Axis labels: the first day, the cycle's start when inside, and the last ("Today"). */
    axis: { x: number; text: string; wide: string }[];
  };
  tracks: DoseTrack[];
  measure: MeasureCard | null;
  tiles: {
    adherence: { value: string; unit: string; context: string } | null;
    checkIns: { value: string; context: string };
    effects: { value: string; context: string };
  };
  effects: EffectRow[];
  /** Newest first. */
  rows: CheckInRow[];
  /** The note while fewer than 3 check-ins exist, else "". */
  sparse: string;
  /** Today's check-in to edit, or null (none yet). */
  todayCheckIn: FormStart | null;
  /** The CSV of this range's check-ins. */
  exportHref: string;
};

export type ProgressScreenInput = {
  /** Newest first (listCycles). */
  cycles: readonly CycleRecord[];
  /** `?cycle=`: an id, NO_CYCLE_PARAM, or null (the default). */
  selectedId: string | null;
  range: ProgressRange | null;
  /** At least the range's days (rangeWindow). */
  checkIns: readonly CheckIn[];
  /** How many check-ins exist in all. */
  total: number;
  /** Recorded doses and skips by cycle id (confirmationsByCycle). */
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>;
  peptides: ViewPeptides;
  now: InstantInput;
};

const RANGE_LABEL: Record<ProgressRange, string> = { "7d": "7-day average", "30d": "30-day average", cycle: "cycle average" };

/** The cycle selected and the days shown: the page reads the check-ins for these. */
export function progressSelection(cycles: readonly CycleRecord[], selectedId: string | null, range: ProgressRange | null, now: InstantInput) {
  const cycle = selectedCycle(cycles, selectedId, now);
  return { cycle, window: rangeWindow(cycle, range, now) };
}

function headerOf(cycle: CycleRecord | null, today: string, now: InstantInput): string {
  if (!cycle) return "Check-ins only";
  const { start, end } = cycleSpan(current(cycle));
  const status = cycleStatus(current(cycle), now);
  if (status === "Upcoming") return `${cycle.name} · starts ${formatMonthDay(start)}`;
  if (status === "Ended") return `${cycle.name} · ended ${formatMonthDay(end)}`;
  return `${cycle.name} · day ${daysBetween(start, today) + 1}`;
}

/** Everything R5 / D3 shows as of `now`. */
export function progressScreen(input: ProgressScreenInput): ProgressScreen {
  const { cycle, window } = progressSelection(input.cycles, input.selectedId, input.range, input.now);
  const { from, to, today, countFrom } = window;
  const days = daysOf(from, to);
  const counted = daysOf(countFrom, to);
  const inRange = input.checkIns.filter((c) => c.day >= from && c.day <= to);
  const inCount = inRange.filter((c) => c.day >= countFrom);
  const byDay = new Map(inRange.map((c) => [c.day, c.feeling]));
  const span = cycle ? cycleSpan(current(cycle)) : null;
  const cycleStart = span?.start ?? null;
  const confirmations = cycle ? (input.confirmations.get(cycle.id) ?? []) : [];

  const preCycle = preCycleFraction(days, cycleStart);
  const axis: ProgressScreen["feeling"]["axis"] = [];
  if (days.length) {
    axis.push({ x: 0, text: formatMonthDay(from), wide: preCycle !== null ? `${formatMonthDay(from)} · before cycle` : formatMonthDay(from) });
    if (preCycle !== null && preCycle < 1) axis.push({ x: preCycle, text: formatMonthDay(cycleStart!), wide: `${formatMonthDay(cycleStart!)} start` });
    const last = to === today ? "Today" : formatMonthDay(to);
    axis.push({ x: 1, text: last, wide: last });
  }

  const occurrences = cycle
    ? [...planOccurrences(cycle.revisions, confirmations).values()].flat().filter((o) => o.localDate >= countFrom && o.localDate <= to)
    : [];
  const stats = cycle ? adherence(occurrences, input.now) : null;
  const doses = cycle ? dosesByDay(input.cycles, input.confirmations, input.peptides, { from, to }) : null;
  const effectDays = inCount.filter((c) => reportedEffects(c).length > 0).length;
  const existing = input.checkIns.find((c) => c.day === today) ?? null;

  return {
    range: window.range,
    ranges: span && span.start <= today ? ["7d", "30d", "cycle"] : ["7d", "30d"],
    from,
    to,
    today,
    cycles: input.cycles.map((c) => ({ id: c.id, name: c.name })),
    cycleId: cycle?.id ?? null,
    header: headerOf(cycle, today, input.now),
    feeling: {
      label: `Feeling · ${RANGE_LABEL[window.range]}`,
      rangeLabel: `${formatMonthDay(countFrom)} – ${formatMonthDay(to)}`,
      average: feelingAverage(byDay, counted),
      change: feelingChange(byDay, counted),
      points: feelingPoints(byDay, days),
      preCycle,
      axis,
    },
    tracks: cycle ? doseTracks(cycle, confirmations, input.peptides, days, input.now) : [],
    measure: measureCard(inRange, days, cycleStart),
    tiles: {
      adherence: stats ? { value: stats.percent === null ? "—" : String(stats.percent), unit: stats.percent === null ? "" : "%", context: adherenceCount(stats) } : null,
      checkIns: { value: String(inCount.length), context: `of ${counted.length} days` },
      effects: { value: String(effectDays), context: effectDays === 1 ? "day reported" : "days reported" },
    },
    effects: effectRows(inCount),
    rows: [...inRange]
      .sort((a, b) => b.day.localeCompare(a.day))
      .map((c) => {
        const dayDoses = doses?.get(c.day) ?? [];
        return {
          day: c.day,
          date: formatDay(c.day),
          today: c.day === today,
          feeling: c.feeling,
          feelingText: `${c.feeling} · ${FEELING_WORDS[c.feeling]}`,
          effects: reportedEffects(c).join(", "),
          note: c.note,
          measure: c.measurement ? `${c.measurement.name} ${c.measurement.value} ${c.measurement.unit}` : "",
          measureName: c.measurement?.name ?? "",
          measureValue: c.measurement ? `${c.measurement.value} ${c.measurement.unit}` : "",
          phase: cycle ? phaseLine(cycle, c.day, input.peptides) : "",
          doses: doses === null ? null : dayDoses.length ? dayDoses.join(", ") : "No doses recorded this day",
        };
      }),
    sparse: input.total < 3 ? SPARSE : "",
    todayCheckIn: existing ? formStart(existing) : null,
    exportHref: `/app/progress/export?from=${from}&to=${to}`,
  };
}

/** A check-in as the edit sheet starts from it (the earlier chips mapped to v3's). */
export function formStart(checkIn: CheckIn): FormStart {
  const start = formEffects(checkIn.effects, checkIn.effectsOther);
  return {
    version: checkIn.version,
    feeling: checkIn.feeling,
    effects: start.effects,
    effectsOther: start.other,
    note: checkIn.note,
    measurement: checkIn.measurement ? { name: checkIn.measurement.name, value: checkIn.measurement.value, unit: checkIn.measurement.unit } : null,
  };
}
