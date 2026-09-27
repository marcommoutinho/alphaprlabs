// Supplement routines' occurrences under their current definition: one per
// local date from the day it took effect (definitionFrom: the create day,
// then the day of the latest edit; Marco, 2026-09-27: edits apply from now
// on) to its end date (open-ended when none), at its daily time in its zone, keyed "<routine id>:<YYYY-MM-DD>". The database derives the same
// (take_supplement and due_supplement_occurrences in
// 20260927100000_supplements.sql, through cycle_local_instant): a time in a
// spring-forward gap moves forward by the gap; a time that occurs twice uses
// the earlier instant (src/lib/schedule/zone.ts, the plan's DST rule).
//
// A routine is far simpler than a peptide plan (one time a day, no phases,
// intervals or weekdays), so it has its own rule rather than the S7 engine,
// and it shares the engine's zone handling and occurrence-key idea.
import { Temporal } from "@js-temporal/polyfill";
import { type DstAdjustment, isLocalDate, type LocalDate, type LocalTime, localDateOf, resolveLocal, type InstantInput, toInstant } from "@/lib/schedule/zone";

/** A routine as the schedule needs it. */
export type RoutineSchedule = {
  id: string;
  /** "HH:MM" */
  time: LocalTime;
  timeZone: string;
  /** The day the current definition took effect: earlier days are not occurrences any more. */
  definitionFrom: LocalDate;
  /** The last day it runs; null while it runs on. */
  endDate: LocalDate | null;
};

export type SupplementOccurrence = {
  key: string;
  routineId: string;
  localDate: LocalDate;
  localTime: LocalTime;
  /** ISO instant ("…Z"). */
  scheduledAt: string;
  dstAdjustment: DstAdjustment;
};

/** "<routine id>:<YYYY-MM-DD>" */
export const supplementKey = (routineId: string, date: LocalDate) => `${routineId}:${date}`;

/** The routine and date of a key, or null when it isn't one. */
export function parseSupplementKey(key: string): { routineId: string; date: LocalDate } | null {
  const match = /^([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  return match && isLocalDate(match[2]) ? { routineId: match[1], date: match[2] } : null;
}

/** True when `date` is an occurrence under the current definition (definitionFrom and the end date included). */
export const runsOn = (routine: Pick<RoutineSchedule, "definitionFrom" | "endDate">, date: LocalDate) =>
  date >= routine.definitionFrom && (routine.endDate === null || date <= routine.endDate);

/** The routine's occurrence on `date`, or null when it doesn't run that day. */
export function occurrenceOn(routine: RoutineSchedule, date: LocalDate): SupplementOccurrence | null {
  if (!isLocalDate(date) || !runsOn(routine, date)) return null;
  const resolved = resolveLocal(date, routine.time, routine.timeZone);
  return {
    key: supplementKey(routine.id, date),
    routineId: routine.id,
    localDate: date,
    localTime: routine.time,
    scheduledAt: resolved.instant.toString(),
    dstAdjustment: resolved.dstAdjustment,
  };
}

/** Its occurrences on the local dates `from` to `to` (both included), in order. */
export function occurrencesBetween(routine: RoutineSchedule, from: LocalDate, to: LocalDate): SupplementOccurrence[] {
  const out: SupplementOccurrence[] = [];
  const first = from > routine.definitionFrom ? from : routine.definitionFrom;
  const last = routine.endDate !== null && routine.endDate < to ? routine.endDate : to;
  for (let date = Temporal.PlainDate.from(first); Temporal.PlainDate.compare(date, Temporal.PlainDate.from(last)) <= 0; date = date.add({ days: 1 })) {
    const occurrence = occurrenceOn(routine, date.toString());
    if (occurrence) out.push(occurrence);
  }
  return out;
}

/** Today in the routine's zone. */
export const todayIn = (now: InstantInput, timeZone: string): LocalDate => localDateOf(toInstant(now), timeZone);
