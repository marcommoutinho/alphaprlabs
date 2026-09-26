// Schedule engine for one peptide timeline (handoff "Business Rules" 1–2 and
// plan D4, "Routine implementation rules", handoff reconciliation 2).
// Pure and deterministic: no I/O, no clock. The caller passes the plan, its
// confirmation history and, where needed, "now".
//
// Rules:
// - Each peptide plan is independent. Its dated phases are either active
//   (dose, local time, schedule) or breaks (no doses). All dates and times are
//   wall-clock in the plan's (cycle's) named IANA zone — never the device's.
// - Occurrence keys are `planId:phaseId:index` (every N days, 0-based) or
//   `planId:phaseId:YYYY-MM-DD` (fixed weekdays), the handoff's Actual key.
// - Fixed weekdays: every selected weekday within the phase dates at the
//   phase's local time. Confirmations never move them.
// - Every N days: the first dose falls on the phase start at the local time.
//   Each later dose falls N calendar days (same wall-clock time, in the plan's
//   zone) after the previous dose's actual time, or after its planned time if
//   it was never confirmed. Unconfirmed doses stay open.
// - A confirmation only moves doses that were still in the future when it was
//   recorded (Confirmation.recordedAt). A dose that had already become due, or
//   had been confirmed, keeps the time it had then: an old unconfirmed dose
//   stays open and actionable at its original time with a stable key, and a
//   backdated confirmation moves the next dose that is not yet due.
// - An older backdated confirmation never moves the next dose earlier than
//   N days after a newer confirmed dose: each interval is anchored on the
//   latest of the previous dose's reference time and every actual time
//   confirmed before it in the sequence.
// - Confirmed doses are facts: they are always returned, with the scheduled
//   time recorded at confirmation when supplied (else the time the dose had
//   when it was confirmed). Unconfirmed doses planned after the phase's last
//   date are dropped, so missed or late doses never extend a phase or restart
//   a finished cycle.
// - DST: a nonexistent local time moves forward by the gap; a repeated local
//   time uses the earlier instant (see zone.ts). Counting on from an
//   unconfirmed dose uses its intended wall-clock time, so one day's shift
//   doesn't carry into later doses.
// - Reminder timing for the dispatcher is in reminders.ts.
// - Dose changes apply from a local date within an active phase, without
//   restarting an every-N-days rhythm. (Starting a new phase does restart it:
//   a phase's first dose is always on its start date.)
import { Temporal } from "@js-temporal/polyfill";
import { isPositiveDecimal, normalizeDecimal } from "@/lib/calculator/decimal";
import {
  type DstAdjustment,
  type InstantInput,
  type LocalDate,
  type LocalTime,
  endOfLocalDay,
  formatLocalTime,
  isLocalDate,
  isLocalTime,
  isValidTimeZone,
  isoInstant,
  localDateOf,
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
  /** Stable, unique within the plan, without ":". Occurrence keys are built from it. */
  id: string;
  kind: "active";
  /** First and last local dates, inclusive. */
  start: LocalDate;
  end: LocalDate;
  /** Planned dose in mg, as a decimal string (dot or comma decimal point). */
  doseMg: string;
  /** Local time of day, "HH:MM". */
  time: LocalTime;
  schedule: Schedule;
  doseChanges?: DoseChange[];
};

export type BreakPhase = { id: string; kind: "break"; start: LocalDate; end: LocalDate };

export type Phase = ActivePhase | BreakPhase;

export type PeptidePlan = {
  /**
   * The peptide plan's stable id, without ":". Occurrence (and so reminder)
   * keys start with it, so two plans with the same phase ids never collide.
   */
  planId: string;
  /** The cycle's IANA time zone, confirmed by the researcher. */
  timeZone: string;
  phases: Phase[];
};

/** A recorded administration for one occurrence. */
export type Confirmation = {
  /** The occurrence key it confirms (`planId:phaseId:index|date`). */
  key: string;
  /** When it was actually taken. Not after `recordedAt`. */
  actualAt: InstantInput;
  /**
   * When the confirmation was recorded (the server's write time; the
   * handoff's Actual.enteredAt). It decides what the confirmation may move:
   * only every-N-days doses still in the future at this instant are
   * re-anchored; doses already due by then keep their time.
   */
  recordedAt: InstantInput;
  /** The scheduled time recorded with the confirmation, if stored. */
  scheduledAt?: InstantInput;
};

export type Occurrence = {
  /** `${planId}:${phaseId}:${index}` for every-N-days (0-based), `${planId}:${phaseId}:${YYYY-MM-DD}` for fixed weekdays. */
  key: string;
  planId: string;
  phaseId: string;
  /** Scheduled instant, ISO UTC ("…Z"). */
  scheduledAt: string;
  /** Local date and "HH:MM" of `scheduledAt` in `timeZone`. */
  localDate: LocalDate;
  localTime: LocalTime;
  timeZone: string;
  /** How the local time was resolved across a daylight-saving change, if at all. */
  dstAdjustment: DstAdjustment;
  /** Planned dose in mg (decimal string, "." as the decimal point). */
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
  | { code: "plan-id" }
  | { code: "time-zone" }
  | { code: "phases" }
  | { code: "no-active-phase" }
  | { code: "phase-id"; phase: number }
  | { code: "duplicate-phase-id"; phase: number }
  | { code: "dates-missing"; phase: number }
  | { code: "dates-out-of-range"; phase: number }
  | { code: "ends-before-start"; phase: number }
  | { code: "phase-too-long"; phase: number }
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

/** Phase dates must fall within these local dates (inclusive). */
export const EARLIEST_PHASE_DATE: LocalDate = "2000-01-01";
export const LATEST_PHASE_DATE: LocalDate = "2100-12-31";
/** Longest phase, in days (inclusive of both ends): about ten years. */
export const MAX_PHASE_DAYS = 3660;
/** Every-N-days interval bounds (the handoff builder: "interval ≥ 1"). */
export const MIN_EVERY_DAYS = 1;
export const MAX_EVERY_DAYS = 365;

// A phase has at most MAX_PHASE_DAYS doses plus confirmed ones; this only
// guards bad input.
const MAX_OCCURRENCES_PER_PHASE = 20_000;

const startOf = (phase: Phase) => (typeof phase?.start === "string" ? phase.start : "");
const byStart = (a: Phase, b: Phase) => startOf(a).localeCompare(startOf(b));

function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

function isKeyPart(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !value.includes(":");
}

function daysBetween(from: LocalDate | Temporal.PlainDate, to: LocalDate | Temporal.PlainDate): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: "days" }).days;
}

/**
 * Validates a plan, in the handoff builder's order: plan id, time zone, the
 * phase list (an array of objects), at least one active phase, then per phase
 * (sorted by start date) id, dates, overlap with the previous phase, and for
 * active phases dose, schedule and time. Returns every issue; an empty list
 * means valid. Copy is the calling screen's.
 */
export function validatePlan(plan: PeptidePlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (!isKeyPart(plan?.planId)) issues.push({ code: "plan-id" });
  if (!isValidTimeZone(plan?.timeZone)) issues.push({ code: "time-zone" });
  // Malformed input (not a list, or entries that aren't objects) is an issue, not a crash.
  const list: unknown[] = Array.isArray(plan?.phases) ? plan.phases : [];
  const isObject = (value: unknown): value is Phase => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!Array.isArray(plan?.phases) || !list.every(isObject)) issues.push({ code: "phases" });
  const phases = list.filter(isObject).sort(byStart);
  if (!phases.some((p) => p?.kind === "active")) issues.push({ code: "no-active-phase" });

  const seen = new Set<string>();
  phases.forEach((phase, index) => {
    const n = index + 1;
    if (!isKeyPart(phase.id)) issues.push({ code: "phase-id", phase: n });
    else if (seen.has(phase.id)) issues.push({ code: "duplicate-phase-id", phase: n });
    seen.add(phase.id);
    const datesValid = isLocalDate(phase.start) && isLocalDate(phase.end);
    if (!datesValid) issues.push({ code: "dates-missing", phase: n });
    else if (phase.start < EARLIEST_PHASE_DATE || phase.end > LATEST_PHASE_DATE) issues.push({ code: "dates-out-of-range", phase: n });
    else if (phase.end < phase.start) issues.push({ code: "ends-before-start", phase: n });
    else if (daysBetween(phase.start, phase.end) + 1 > MAX_PHASE_DAYS) issues.push({ code: "phase-too-long", phase: n });
    const previous = phases[index - 1];
    if (previous && datesValid && isLocalDate(previous.end) && previous.end >= phase.start) {
      issues.push({ code: "overlap", phases: [n - 1, n] });
    }
    if (phase.kind !== "active") return;

    if (!isPositiveDecimal(phase.doseMg)) issues.push({ code: "dose", phase: n });
    const schedule = phase.schedule;
    if (schedule?.type === "interval") {
      const every = schedule.everyDays;
      if (!Number.isInteger(every) || every < MIN_EVERY_DAYS || every > MAX_EVERY_DAYS) issues.push({ code: "interval", phase: n });
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
  let dose = phase.doseMg;
  let from = "";
  for (const change of phase.doseChanges ?? []) {
    if (change.from <= date && change.from > from) {
      dose = change.doseMg;
      from = change.from;
    }
  }
  // Validated: always a decimal. Canonical text, "." as the decimal point.
  return normalizeDecimal(dose) ?? dose.trim();
}

/** A point to count an interval from: its instant, and the wall-clock time the next dose repeats. */
type Anchor = { instant: Temporal.Instant; wall: Temporal.PlainDateTime };

const laterAnchor = (a: Anchor, b: Anchor | null) => (b && Temporal.Instant.compare(b.instant, a.instant) > 0 ? b : a);

type ParsedConfirmation = {
  actual: Temporal.Instant;
  recorded: Temporal.Instant;
  scheduled: Temporal.Instant | null;
};

function parseConfirmations(confirmations: readonly Confirmation[]): Map<string, ParsedConfirmation> {
  if (!Array.isArray(confirmations)) throw new ScheduleInputError("Confirmations must be a list");
  const map = new Map<string, ParsedConfirmation>();
  for (const confirmation of confirmations) {
    const key = confirmation?.key;
    if (typeof key !== "string") throw new ScheduleInputError("Confirmation without a key");
    if (map.has(key)) throw new ScheduleInputError(`Duplicate confirmation for ${key}`);
    let parsed: ParsedConfirmation;
    try {
      parsed = {
        actual: toInstant(confirmation.actualAt),
        recorded: toInstant(confirmation.recordedAt),
        scheduled: confirmation.scheduledAt === undefined ? null : toInstant(confirmation.scheduledAt),
      };
    } catch {
      throw new ScheduleInputError(`Invalid time on confirmation ${key}`);
    }
    if (Temporal.Instant.compare(parsed.actual, parsed.recorded) > 0) {
      throw new ScheduleInputError(`Confirmation ${key} was taken after it was recorded`);
    }
    map.set(key, parsed);
  }
  return map;
}

/** A resolved planned time: the instant, its intended wall-clock time, and any DST adjustment. */
type Slot = { instant: Temporal.Instant; wall: Temporal.PlainDateTime; dstAdjustment: DstAdjustment };

type Draft = { instant: Temporal.Instant; occurrence: Omit<Occurrence, "remindersStopAt"> };

type Context = { planId: string; timeZone: string; phase: ActivePhase };

function slotAt(wall: Temporal.PlainDateTime, timeZone: string): Slot {
  const resolved = resolveWallClock(wall, timeZone);
  return { instant: resolved.instant, wall, dstAdjustment: resolved.dstAdjustment };
}

function draft({ planId, timeZone, phase }: Context, key: string, planned: Slot, confirmation: ParsedConfirmation | undefined): Draft {
  // A confirmed dose keeps the scheduled time recorded with it.
  const recorded = confirmation?.scheduled ?? null;
  const instant = recorded ?? planned.instant;
  const local = wallClock(instant, timeZone);
  const localDate = local.toPlainDate().toString();
  return {
    instant,
    occurrence: {
      key,
      planId,
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

/**
 * Every-N-days occurrences. The schedule is replayed in the order the
 * confirmations were recorded: at each recording, every unconfirmed
 * occurrence already due by then (and the one being confirmed) is frozen at
 * the time it had; only occurrences still in the future are re-anchored.
 * The whole phase is generated; there is no range shortcut.
 */
function intervalDrafts(ctx: Context, everyDays: number, confirmations: Map<string, ParsedConfirmation>): Draft[] {
  const { planId, timeZone, phase } = ctx;
  const prefix = `${planId}:${phase.id}:`;
  const start = Temporal.PlainDate.from(phase.start).toPlainDateTime(Temporal.PlainTime.from(phase.time));
  const end = Temporal.PlainDate.from(phase.end);
  const beyondEnd = (slot: Slot) => Temporal.PlainDate.compare(slot.wall.toPlainDate(), end) > 0;

  // This phase's confirmations, grouped by recording instant, oldest first.
  type Entry = { index: number; confirmation: ParsedConfirmation; anchor: Anchor };
  const entries: Entry[] = [];
  for (const [key, confirmation] of confirmations) {
    const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : "";
    if (!/^(0|[1-9]\d{0,5})$/.test(suffix) || Number(suffix) >= MAX_OCCURRENCES_PER_PHASE) continue;
    entries.push({ index: Number(suffix), confirmation, anchor: { instant: confirmation.actual, wall: wallClock(confirmation.actual, timeZone) } });
  }
  entries.sort((a, b) => Temporal.Instant.compare(a.confirmation.recorded, b.confirmation.recorded) || a.index - b.index);
  const groups: Entry[][] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last[0].confirmation.recorded.equals(entry.confirmation.recorded)) last.push(entry);
    else groups.push([entry]);
  }

  // Replay state. Occurrences below `lowest` are all frozen; `latestBelow` is
  // the newest actual among applied confirmations with an index below it.
  const frozen = new Map<number, Slot>();
  const applied = new Map<number, Entry>();
  let maxApplied = -1;
  let lowest = 0;
  let latestBelow: Anchor | null = null;
  const referenceOf = (index: number): Anchor => {
    const entry = applied.get(index);
    if (entry) return entry.anchor;
    const slot = frozen.get(index)!;
    return { instant: slot.instant, wall: slot.wall };
  };

  // The current schedule from `lowest` upward (frozen or computed).
  function* current(): Generator<{ index: number; slot: Slot; isFrozen: boolean }> {
    let latest = latestBelow;
    let reference: Anchor | null = lowest === 0 ? null : referenceOf(lowest - 1);
    for (let index = lowest; index < MAX_OCCURRENCES_PER_PHASE; index++) {
      const fixed = frozen.get(index);
      // The intended wall-clock time. An unconfirmed dose repeats its intended
      // time, so a daylight-saving shift on one day doesn't carry forward.
      const slot = fixed ?? slotAt(reference === null ? start : laterAnchor(reference, latest).wall.add({ days: everyDays }), timeZone);
      yield { index, slot, isFrozen: fixed !== undefined };
      const entry = applied.get(index);
      if (entry) {
        reference = entry.anchor;
        latest = laterAnchor(entry.anchor, latest);
      } else {
        reference = { instant: slot.instant, wall: slot.wall };
      }
    }
    throw new ScheduleInputError(`Phase ${phase.id} has too many occurrences`);
  }

  for (const group of groups) {
    const at = group[0].confirmation.recorded;
    const targets = new Map(group.map((entry) => [entry.index, entry]));
    const maxTarget = Math.max(...targets.keys());
    const toFreeze: [number, Slot][] = [];
    // Confirming a dose that is already frozen (an old open dose) keeps its time.
    const accepted: Entry[] = group.filter((entry) => entry.index < lowest);
    for (const { index, slot, isFrozen } of current()) {
      const target = targets.get(index);
      const outside = !isFrozen && beyondEnd(slot);
      // Already due when this was recorded, or being confirmed now: keep its time.
      if (!isFrozen && !outside && (target || Temporal.Instant.compare(slot.instant, at) <= 0)) toFreeze.push([index, slot]);
      // A confirmation for an occurrence that doesn't exist (past the phase) matches nothing.
      if (target && !outside) accepted.push(target);
      if (!isFrozen && index > maxApplied && (outside || (index >= maxTarget && Temporal.Instant.compare(slot.instant, at) > 0))) break;
    }
    for (const [index, slot] of toFreeze) frozen.set(index, slot);
    for (const entry of accepted) {
      applied.set(entry.index, entry);
      maxApplied = Math.max(maxApplied, entry.index);
      if (entry.index < lowest) latestBelow = laterAnchor(entry.anchor, latestBelow);
    }
    while (frozen.has(lowest)) {
      const entry = applied.get(lowest);
      if (entry) latestBelow = laterAnchor(entry.anchor, latestBelow);
      lowest++;
    }
  }

  // Final schedule: the frozen history, then the live rhythm to the phase end.
  // Always the whole phase (at most MAX_PHASE_DAYS days); callers filter.
  const lastFixed = Math.max(-1, maxApplied, ...frozen.keys());
  const drafts: Draft[] = [];
  const push = (index: number, slot: Slot) => drafts.push(draft(ctx, `${prefix}${index}`, slot, applied.get(index)?.confirmation));
  for (let index = 0; index < lowest; index++) push(index, frozen.get(index)!);

  let latest = latestBelow;
  let reference: Anchor | null = lowest === 0 ? null : referenceOf(lowest - 1);
  for (let index = lowest; ; index++) {
    if (index >= MAX_OCCURRENCES_PER_PHASE) throw new ScheduleInputError(`Phase ${phase.id} has too many occurrences`);
    const fixed = frozen.get(index);
    const slot = fixed ?? slotAt(reference === null ? start : laterAnchor(reference, latest).wall.add({ days: everyDays }), timeZone);
    const entry = applied.get(index);
    // Frozen and confirmed doses are always kept; a live dose past the phase end is dropped,
    // and once past every frozen or confirmed index, so is everything after it.
    if (fixed || entry || !beyondEnd(slot)) push(index, slot);
    else if (index > lastFixed) break;
    if (entry) {
      reference = entry.anchor;
      latest = laterAnchor(entry.anchor, latest);
    } else {
      reference = { instant: slot.instant, wall: slot.wall };
    }
  }
  return drafts;
}

// Every selected weekday in the phase. Always the whole phase; callers filter.
function weekdayDrafts(ctx: Context, days: Weekday[], confirmations: Map<string, ParsedConfirmation>): Draft[] {
  const { planId, timeZone, phase } = ctx;
  const drafts: Draft[] = [];
  const last = Temporal.PlainDate.from(phase.end);
  const time = Temporal.PlainTime.from(phase.time);
  for (let date = Temporal.PlainDate.from(phase.start); Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 })) {
    if (!days.includes((date.dayOfWeek % 7) as Weekday)) continue;
    const key = `${planId}:${phase.id}:${date.toString()}`;
    drafts.push(draft(ctx, key, slotAt(date.toPlainDateTime(time), timeZone), confirmations.get(key)));
  }
  return drafts;
}

/**
 * The plan's active-phase occurrences, sorted by scheduled time (then key),
 * optionally limited to local dates `from`–`to` (inclusive, in the plan's
 * zone). Every phase is always computed in full (at most MAX_PHASE_DAYS
 * days) and only then filtered by local date, so a ranged result is exactly
 * the matching part of the full schedule. Confirmations whose key matches no
 * occurrence are ignored.
 * Throws ScheduleInputError for an invalid plan, confirmation or range.
 */
export function scheduleOccurrences(
  plan: PeptidePlan,
  confirmations: readonly Confirmation[] = [],
  range?: { from?: LocalDate; to?: LocalDate },
): Occurrence[] {
  const issues = validatePlan(plan);
  if (issues.length > 0) throw new ScheduleInputError("Invalid plan", issues);
  if ((range?.from !== undefined && !isLocalDate(range.from)) || (range?.to !== undefined && !isLocalDate(range.to))) {
    throw new ScheduleInputError("Invalid range");
  }
  const confirmed = parseConfirmations(confirmations);
  const { planId, timeZone } = plan;

  const result: Occurrence[] = [];
  for (const phase of [...plan.phases].sort(byStart)) {
    if (phase.kind !== "active") continue;
    const ctx: Context = { planId, timeZone, phase };
    const drafts =
      phase.schedule.type === "interval"
        ? intervalDrafts(ctx, phase.schedule.everyDays, confirmed)
        : weekdayDrafts(ctx, phase.schedule.days, confirmed);
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
