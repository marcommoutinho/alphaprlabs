// Schedule engine for one peptide timeline (handoff "Business Rules" 1–2 and
// plan D4, "Routine implementation rules", handoff reconciliation 2).
// Pure and deterministic: no I/O, no clock. The caller passes the plan, its
// confirmation history and, where needed, "now".
//
// Rules:
// - Each peptide plan is independent. Its dated phases are either active
//   (dose, local time, schedule) or breaks (no doses). All dates and times are
//   wall-clock in the plan's (cycle's) named IANA zone — never the device's.
// - Fixed weekdays: every selected weekday within the phase dates at the
//   phase's local time. Confirmations never move them.
// - Every N days: the first dose falls on the phase start at the local time.
//   Each later dose falls N calendar days (same wall-clock time, in the plan's
//   zone) after the previous dose's actual time, or after its planned time if
//   it was never confirmed. Unconfirmed doses stay open.
// - An older backdated confirmation never moves the next dose earlier than
//   N days after a newer confirmed dose: each interval is anchored on the
//   latest of the previous dose's reference time and every actual time
//   confirmed before it in the sequence.
// - Confirmed doses are facts: they are always returned, with the scheduled
//   time recorded at confirmation when supplied. Unconfirmed doses planned
//   after the phase's last date are dropped, so missed or late doses never
//   extend a phase or restart a finished cycle.
// - DST: a nonexistent local time moves forward by the gap; a repeated local
//   time uses the earlier instant (see zone.ts). Counting on from an
//   unconfirmed dose uses its intended wall-clock time, so one day's shift
//   doesn't carry into later doses.
// - Reminder timing for the dispatcher is in reminders.ts.
// - Dose changes apply from a local date within an active phase, without
//   restarting an every-N-days rhythm. (Starting a new phase does restart it:
//   a phase's first dose is always on its start date.)
import { Temporal } from "@js-temporal/polyfill";
import { isPositiveDecimal } from "@/lib/calculator/decimal";
import {
  type DstAdjustment,
  type InstantInput,
  type ResolvedTime,
  type LocalDate,
  type LocalTime,
  endOfLocalDay,
  formatLocalTime,
  isLocalDate,
  isLocalTime,
  isValidTimeZone,
  isoInstant,
  localDateOf,
  resolveLocal,
  resolveWallClock,
  toInstant,
  wallClock,
} from "./zone";

/** 0 = Sunday … 6 = Saturday (the handoff's data model). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule = { type: "interval"; everyDays: number } | { type: "weekdays"; days: Weekday[] };

/** A dose that applies to occurrences on or after `from` (local date) within its phase. */
export type DoseChange = { from: LocalDate; doseMg: string };

export type ActivePhase = {
  /** Stable, unique within the plan. Occurrence keys are built from it. */
  id: string;
  kind: "active";
  /** First and last local dates, inclusive. */
  start: LocalDate;
  end: LocalDate;
  /** Planned dose in mg, as a decimal string. */
  doseMg: string;
  /** Local time of day, "HH:MM". */
  time: LocalTime;
  schedule: Schedule;
  doseChanges?: DoseChange[];
};

export type BreakPhase = { id: string; kind: "break"; start: LocalDate; end: LocalDate };

export type Phase = ActivePhase | BreakPhase;

export type PeptidePlan = {
  /** The cycle's IANA time zone, confirmed by the researcher. */
  timeZone: string;
  phases: Phase[];
};

/** A recorded administration for one occurrence. */
export type Confirmation = {
  /** The occurrence key it confirms. */
  key: string;
  /** When it was actually taken. */
  actualAt: InstantInput;
  /** The scheduled time recorded with the confirmation, if stored. */
  scheduledAt?: InstantInput;
};

export type Occurrence = {
  /** `${phaseId}:${index}` for every-N-days (0-based), `${phaseId}:${YYYY-MM-DD}` for fixed weekdays. */
  key: string;
  phaseId: string;
  /** Scheduled instant, ISO UTC ("…Z"). */
  scheduledAt: string;
  /** Local date and "HH:MM" of `scheduledAt` in `timeZone`. */
  localDate: LocalDate;
  localTime: LocalTime;
  timeZone: string;
  /** How the local time was resolved across a daylight-saving change, if at all. */
  dstAdjustment: DstAdjustment;
  /** Planned dose in mg (decimal string). */
  doseMg: string;
  /** Actual time (ISO UTC) when confirmed, else null. */
  actualAt: string | null;
  /**
   * Reminders and follow-ups for this occurrence stop at this instant (ISO
   * UTC): the phase's end or the next occurrence in the phase becoming due,
   * whichever is first. Confirmation stops them too.
   */
  remindersStopAt: string;
};

/** Dose states (handoff Business Rules 2), by local date in the plan's zone. */
export type OccurrenceState = "taken" | "due" | "open" | "planned";

/** Validation issues; `phase` numbers are 1-based after sorting by start date. */
export type PlanIssue =
  | { code: "time-zone" }
  | { code: "no-active-phase" }
  | { code: "duplicate-phase-id"; phase: number }
  | { code: "dates-missing"; phase: number }
  | { code: "ends-before-start"; phase: number }
  | { code: "overlap"; phases: [number, number] }
  | { code: "dose"; phase: number }
  | { code: "schedule"; phase: number }
  | { code: "interval"; phase: number }
  | { code: "weekdays"; phase: number }
  | { code: "time"; phase: number }
  | { code: "dose-change"; phase: number };

export class ScheduleInputError extends Error {
  constructor(
    message: string,
    readonly issues: PlanIssue[] = [],
  ) {
    super(message);
    this.name = "ScheduleInputError";
  }
}

// A phase is at most a few years of daily doses; this only guards bad input.
const MAX_OCCURRENCES_PER_PHASE = 20_000;

const byStart = (a: Phase, b: Phase) => (a.start ?? "").localeCompare(b.start ?? "");

function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

/**
 * Validates a plan, in the handoff builder's order: time zone, at least one
 * active phase, then per phase (sorted by start date) dates, overlap with the
 * previous phase, and for active phases dose, schedule and time. Returns every
 * issue; an empty list means valid. Copy is the calling screen's.
 */
export function validatePlan(plan: PeptidePlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (!isValidTimeZone(plan?.timeZone)) issues.push({ code: "time-zone" });
  const phases = Array.isArray(plan?.phases) ? [...plan.phases].sort(byStart) : [];
  if (!phases.some((p) => p?.kind === "active")) issues.push({ code: "no-active-phase" });

  const seen = new Set<string>();
  phases.forEach((phase, index) => {
    const n = index + 1;
    if (typeof phase.id !== "string" || phase.id === "" || seen.has(phase.id)) {
      issues.push({ code: "duplicate-phase-id", phase: n });
    }
    seen.add(phase.id);
    const datesValid = isLocalDate(phase.start) && isLocalDate(phase.end);
    if (!datesValid) issues.push({ code: "dates-missing", phase: n });
    else if (phase.end < phase.start) issues.push({ code: "ends-before-start", phase: n });
    const previous = phases[index - 1];
    if (previous && datesValid && isLocalDate(previous.end) && previous.end >= phase.start) {
      issues.push({ code: "overlap", phases: [n - 1, n] });
    }
    if (phase.kind !== "active") return;

    if (!isPositiveDecimal(phase.doseMg)) issues.push({ code: "dose", phase: n });
    const schedule = phase.schedule;
    if (schedule?.type === "interval") {
      if (!Number.isInteger(schedule.everyDays) || schedule.everyDays < 1) issues.push({ code: "interval", phase: n });
    } else if (schedule?.type === "weekdays") {
      const days = schedule.days;
      if (!Array.isArray(days) || days.length === 0 || !days.every(isWeekday) || new Set(days).size !== days.length) {
        issues.push({ code: "weekdays", phase: n });
      }
    } else {
      issues.push({ code: "schedule", phase: n });
    }
    if (!isLocalTime(phase.time)) issues.push({ code: "time", phase: n });
    const changes = phase.doseChanges ?? [];
    const froms = new Set<string>();
    const changesValid =
      Array.isArray(changes) &&
      changes.every((change) => {
        const ok =
          isLocalDate(change?.from) &&
          (!datesValid || (change.from >= phase.start && change.from <= phase.end)) &&
          isPositiveDecimal(change.doseMg) &&
          !froms.has(change.from);
        froms.add(change?.from);
        return ok;
      });
    if (!changesValid) issues.push({ code: "dose-change", phase: n });
  });
  return issues;
}

function doseOn(phase: ActivePhase, date: LocalDate): string {
  let dose = phase.doseMg.trim();
  let from = "";
  for (const change of phase.doseChanges ?? []) {
    if (change.from <= date && change.from > from) {
      dose = change.doseMg.trim();
      from = change.from;
    }
  }
  return dose;
}

type ParsedConfirmation = { actual: Temporal.Instant; scheduled: Temporal.Instant | null };

function parseConfirmations(confirmations: readonly Confirmation[]): Map<string, ParsedConfirmation> {
  const map = new Map<string, ParsedConfirmation>();
  for (const confirmation of confirmations) {
    if (map.has(confirmation.key)) throw new ScheduleInputError(`Duplicate confirmation for ${confirmation.key}`);
    try {
      map.set(confirmation.key, {
        actual: toInstant(confirmation.actualAt),
        scheduled: confirmation.scheduledAt === undefined ? null : toInstant(confirmation.scheduledAt),
      });
    } catch {
      throw new ScheduleInputError(`Invalid time on confirmation ${confirmation.key}`);
    }
  }
  return map;
}

/** A point to count an interval from: its instant, and the wall-clock time the next dose repeats. */
type Anchor = { instant: Temporal.Instant; wall: Temporal.PlainDateTime };

const laterAnchor = (a: Anchor, b: Anchor | null) => (b && Temporal.Instant.compare(b.instant, a.instant) > 0 ? b : a);

type Draft = { instant: Temporal.Instant; occurrence: Omit<Occurrence, "remindersStopAt"> };

function draft(
  phase: ActivePhase,
  key: string,
  planned: ResolvedTime,
  confirmation: ParsedConfirmation | undefined,
  timeZone: string,
): Draft {
  // A confirmed dose keeps the scheduled time recorded with it.
  const recorded = confirmation?.scheduled ?? null;
  const instant = recorded ?? planned.instant;
  const local = wallClock(instant, timeZone);
  const localDate = local.toPlainDate().toString();
  return {
    instant,
    occurrence: {
      key,
      phaseId: phase.id,
      scheduledAt: isoInstant(instant),
      localDate,
      localTime: formatLocalTime(local),
      timeZone,
      dstAdjustment: recorded ? null : planned.dstAdjustment,
      doseMg: doseOn(phase, localDate),
      actualAt: confirmation ? isoInstant(confirmation.actual) : null,
    },
  };
}

function intervalDrafts(
  phase: ActivePhase,
  everyDays: number,
  confirmations: Map<string, ParsedConfirmation>,
  timeZone: string,
): Draft[] {
  const prefix = `${phase.id}:`;
  let lastConfirmedIndex = -1;
  for (const key of confirmations.keys()) {
    const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : "";
    if (/^(0|[1-9]\d*)$/.test(suffix)) lastConfirmedIndex = Math.max(lastConfirmedIndex, Number(suffix));
  }

  const drafts: Draft[] = [];
  let reference: Anchor | null = null; // previous dose: actual, else planned
  let latestActual: Anchor | null = null; // newest actual so far in the sequence
  for (let index = 0; ; index++) {
    if (index > MAX_OCCURRENCES_PER_PHASE) throw new ScheduleInputError(`Phase ${phase.id} has too many occurrences`);
    // The intended wall-clock time. An unconfirmed dose repeats its intended
    // time, so a daylight-saving shift on one day doesn't carry forward.
    const wall: Temporal.PlainDateTime =
      reference === null
        ? Temporal.PlainDate.from(phase.start).toPlainDateTime(Temporal.PlainTime.from(phase.time))
        : laterAnchor(reference, latestActual).wall.add({ days: everyDays });
    const planned = resolveWallClock(wall, timeZone);
    const plannedDate = wall.toPlainDate().toString();
    const key = `${prefix}${index}`;
    const confirmation = confirmations.get(key);
    if (plannedDate > phase.end && index > lastConfirmedIndex) break;
    if (confirmation || plannedDate <= phase.end) drafts.push(draft(phase, key, planned, confirmation, timeZone));
    if (confirmation) {
      const actual = { instant: confirmation.actual, wall: wallClock(confirmation.actual, timeZone) };
      reference = actual;
      latestActual = laterAnchor(actual, latestActual);
    } else {
      reference = { instant: planned.instant, wall };
    }
  }
  return drafts;
}

function weekdayDrafts(
  phase: ActivePhase,
  days: Weekday[],
  confirmations: Map<string, ParsedConfirmation>,
  timeZone: string,
): Draft[] {
  const drafts: Draft[] = [];
  const last = Temporal.PlainDate.from(phase.end);
  for (let date = Temporal.PlainDate.from(phase.start); Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 })) {
    if (!days.includes((date.dayOfWeek % 7) as Weekday)) continue;
    const localDate = date.toString();
    const key = `${phase.id}:${localDate}`;
    drafts.push(draft(phase, key, resolveLocal(localDate, phase.time, timeZone), confirmations.get(key), timeZone));
  }
  return drafts;
}

/**
 * Every occurrence of the plan's active phases, sorted by scheduled time
 * (then key), optionally limited to local dates `from`–`to` (inclusive, in
 * the plan's zone). Confirmations whose key matches no occurrence are ignored.
 * Throws ScheduleInputError for an invalid plan or confirmation.
 */
export function scheduleOccurrences(
  plan: PeptidePlan,
  confirmations: readonly Confirmation[] = [],
  range?: { from?: LocalDate; to?: LocalDate },
): Occurrence[] {
  const issues = validatePlan(plan);
  if (issues.length > 0) throw new ScheduleInputError("Invalid plan", issues);
  const confirmed = parseConfirmations(confirmations);
  const timeZone = plan.timeZone;

  const result: Occurrence[] = [];
  for (const phase of [...plan.phases].sort(byStart)) {
    if (phase.kind !== "active") continue;
    const drafts =
      phase.schedule.type === "interval"
        ? intervalDrafts(phase, phase.schedule.everyDays, confirmed, timeZone)
        : weekdayDrafts(phase, phase.schedule.days, confirmed, timeZone);
    const phaseEnd = endOfLocalDay(phase.end, timeZone);
    drafts.forEach(({ occurrence }, i) => {
      const next = drafts[i + 1]?.instant;
      const stop = next && Temporal.Instant.compare(next, phaseEnd) < 0 ? next : phaseEnd;
      result.push({ ...occurrence, remindersStopAt: isoInstant(stop) });
    });
  }

  return result
    .filter((o) => (!range?.from || o.localDate >= range.from) && (!range?.to || o.localDate <= range.to))
    .sort((a, b) => compareInstants(a.scheduledAt, b.scheduledAt) || a.key.localeCompare(b.key));
}

function compareInstants(a: string, b: string): number {
  return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
}

/**
 * The handoff's dose state, by local date in the occurrence's zone:
 * taken (confirmed), due (today), open (an earlier day; "Unconfirmed"),
 * planned (a later day). A "due" dose may still be later today; compare
 * `scheduledAt` with now for "Due" versus "Later today".
 */
export function occurrenceState(occurrence: Occurrence, now: InstantInput): OccurrenceState {
  if (occurrence.actualAt) return "taken";
  const today = localDateOf(now, occurrence.timeZone);
  if (occurrence.localDate === today) return "due";
  return occurrence.localDate < today ? "open" : "planned";
}

/** True when unconfirmed and its scheduled time has arrived (counts toward the app badge). */
export function isAwaitingConfirmation(occurrence: Occurrence, now: InstantInput): boolean {
  return !occurrence.actualAt && Temporal.Instant.compare(Temporal.Instant.from(occurrence.scheduledAt), toInstant(now)) <= 0;
}

/** The earliest unconfirmed occurrence scheduled at or after `now`, or null. */
export function nextDue(occurrences: readonly Occurrence[], now: InstantInput): Occurrence | null {
  const at = toInstant(now);
  let best: Occurrence | null = null;
  for (const occurrence of occurrences) {
    if (occurrence.actualAt) continue;
    if (Temporal.Instant.compare(Temporal.Instant.from(occurrence.scheduledAt), at) < 0) continue;
    if (!best || compareInstants(occurrence.scheduledAt, best.scheduledAt) < 0) best = occurrence;
  }
  return best;
}
