// R1 Today and R5 Confirm: copy, the syringe draw shown for a dose, wall-clock
// helpers for the "When you actually took it" field, what a confirmation does
// to the schedule, and the confirmation's validation. Pure and client-safe
// (no Temporal): shared by the screens, the server action and tests.
//
// Times in the sheet are wall-clock times in the dose's own zone (the cycle's
// named zone, never the phone's), written "YYYY-MM-DDTHH:MM" as a
// datetime-local input holds them. The server turns them into instants.
import {
  calculate,
  type LineSpacing,
  SYRINGE_LABEL,
  type SyringeCapacity,
  UNKNOWN_LINES_MESSAGE,
} from "@/lib/calculator/calculator";
import { normalizeDecimal, parseDecimal } from "@/lib/calculator/decimal";
import { formatDay } from "@/lib/format";
import { vialName } from "@/lib/supplies/name";
import { RECORDED_SITES } from "./sites";

export const NOTES_LIMIT = 1000;
export const AMOUNT_LIMIT = "100000";

// ── Copy ────────────────────────────────────────────────────────────────────

export const AMOUNT_REQUIRED = "Enter the amount actually taken.";
export const AMOUNT_TOO_LARGE = "The amount can be up to 100,000 mg.";
export const TIME_REQUIRED = "Enter when you actually took it.";
export const TIME_FUTURE = "The actual time can't be in the future.";
export const TIME_TOO_EARLY = "The actual time can't be more than a day before the planned time.";
export const NOTES_TOO_LONG = "Observations can be up to 1,000 characters.";
export const DOSE_CHANGED = "This dose changed since you opened it. The details below are current — check them and confirm again.";
export const DOSE_GONE = "This dose is no longer in your plan. Nothing was recorded.";
export const DOSE_NOT_YET = "This dose isn't due yet. You can confirm it on its day.";
export const STALE_LINK = "That reminder is out of date — this dose is no longer in your plan. Here's what's due now.";
export const ENDED_NOTE = "Unconfirmed entries from ended cycles stay open in that cycle's history.";
export const NO_MIXTURE_NOTE = "No saved mixture for this peptide, so syringe units can't be shown.";
export const VIAL_NOTE = (label: string) =>
  `Confirming reduces the estimate for ${vialName(label, true)} by the amount taken. It's an estimate, not a measurement.`;
export const lateNote = (days: number) =>
  `You're recording this ${days} day${days === 1 ? "" : "s"} after it happened. That's fine — the actual time is what the schedule uses.`;
// V1 (design v3 §7.15 and the new Skip / Undo).
/** "TB-500 · 2.5 mg logged at 9:12 AM" (the Undo toast after Taken). */
export const loggedToast = (peptide: string, amount: string, at: string) => `${peptide} · ${amount} logged at ${at}`;
/** "TB-500 · 9:00 AM skipped" (the Undo toast after Skip). */
export const skippedToast = (peptide: string, planned: string) => `${peptide} · ${planned} skipped`;
export const undoneToast = (peptide: string) => `Undone. ${peptide} is open again.`;
export const UNDO_TOO_LATE = "It's too late to undo that entry. It stays recorded.";
export const UNDO_DEPENDS = "Something was recorded after that entry, so it can't be undone.";
export const UNDO_FAILED = "Couldn't undo. The entry is still recorded.";
export const ALREADY_SKIPPED = "This dose was skipped, so it can't be logged.";
export const DOSE_ALREADY_TAKEN = "This dose is already logged.";
export const SKIPPED_NOTE = "You marked this dose skipped. It counts as skipped, not missed, and can't be logged now.";

// ── The syringe draw for a dose ─────────────────────────────────────────────

/** A saved mixture's setup as the screens need it. */
export type DrawSetup = { vialMg: string; liquidMl: string; syringe: SyringeCapacity; lineSpacing: LineSpacing };

export type DrawDisplay =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "units"; units: string; volume: string; onLine: boolean | null; flag: string | null };

/**
 * Units for `doseMg` from a saved setup, never rounded, with R1's flag: a
 * dose between printed lines first, then one over the syringe's capacity,
 * then unknown line spacing.
 */
export function drawDisplay(setup: DrawSetup | null, doseMg: string): DrawDisplay {
  if (!setup) return { kind: "none" };
  const result = calculate({ ...setup, doseMg });
  if (!result.ok) return { kind: "error", message: result.errors.join(" ") };
  const units = result.display.units;
  const syringe = SYRINGE_LABEL[setup.syringe];
  const flag =
    result.onLine === false
      ? `${units} units does not land on a line (this syringe is lined every ${setup.lineSpacing} units). Check with the calculator before drawing.`
      : result.overCapacity
        ? `${units} units exceeds this ${syringe} syringe.`
        : result.onLine === null
          ? UNKNOWN_LINES_MESSAGE
          : null;
  return { kind: "units", units, volume: result.display.volume, onLine: result.onLine, flag };
}

/** "10 units", "no saved mixture" or "units can't be calculated" (Today's rows). */
export function unitsLabel(draw: DrawDisplay): string {
  if (draw.kind === "none") return "no saved mixture";
  if (draw.kind === "error") return "units can't be calculated";
  return `${draw.units} units`;
}

/** The sheet's line beside the amount: "= 10 units", "= 10.5 units · not on a line", or why not. */
export function sheetUnitsLabel(setup: DrawSetup | null, amount: string): string {
  if (!setup) return "no saved mixture";
  const mg = normalizeDecimal(amount);
  if (mg === null || !parseDecimal(mg)?.greaterThan(0)) return "enter an amount";
  const draw = drawDisplay(setup, mg);
  if (draw.kind !== "units") return "units can't be calculated";
  return `= ${draw.units} units${draw.onLine === false ? " · not on a line" : ""}`;
}

// ── Wall-clock times in a zone ──────────────────────────────────────────────

/** "YYYY-MM-DDTHH:MM", a datetime-local value. */
export type Wall = string;

const WALL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

export const isWall = (value: unknown): value is Wall => typeof value === "string" && WALL.test(value);

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock time of an instant in a zone, to the minute. */
export function wallOf(at: Date | string, timeZone: string): Wall {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(typeof at === "string" ? new Date(at) : at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** A local date plus `days`. */
export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from one local date to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** `Fri Sep 11 · 20:00` */
export const wallLabel = (wall: Wall) => `${formatDay(wall.slice(0, 10))} · ${wall.slice(11, 16)}`;

// ── What a confirmation does to the schedule (R5's effect line) ──────────────

export type ScheduleEffect =
  | { kind: "weekdays"; days: string; time: string }
  | {
      kind: "interval";
      everyDays: number;
      /** The phase's last date: a next dose after it is dropped. */
      phaseEnd: string;
      timeChanges: { from: string; time: string }[];
      /** The latest actual time among earlier recorded doses of this phase: the next never counts from before it. */
      floor: Wall | null;
      /** The next dose of the phase exists: "moves" while it is still ahead, else it keeps its time. */
      next: "moves" | "kept" | "none";
    };

/** The next every-N-days dose after a dose taken at `actual` (the engine's rule, in wall-clock terms). */
export function nextIntervalDose(effect: Extract<ScheduleEffect, { kind: "interval" }>, actual: Wall): Wall | null {
  const anchor = effect.floor && effect.floor > actual ? effect.floor : actual;
  const date = addDaysToDate(anchor.slice(0, 10), effect.everyDays);
  if (date > effect.phaseEnd) return null;
  const change = effect.timeChanges.filter((c) => c.from > anchor.slice(0, 10) && c.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0];
  return `${date}T${change ? change.time : anchor.slice(11, 16)}`;
}

/** R5's line on what this entry does to the schedule, plus when the entry itself is recorded. */
export function effectText(effect: ScheduleEffect, peptide: string, actual: Wall | null, now: Wall): string {
  let text: string;
  if (effect.kind === "weekdays") {
    text = `${peptide} keeps its fixed weekdays (${effect.days} ${effect.time}); this entry doesn't shift the schedule.`;
  } else if (effect.next === "kept") {
    text = `Later ${peptide} doses that are already due keep their times; this entry doesn't move them.`;
  } else if (effect.next === "none" || !actual) {
    text = effect.next === "none" ? `This is the last ${peptide} dose of this phase.` : "";
  } else {
    const next = nextIntervalDose(effect, actual);
    text = next
      ? `Next ${peptide} moves to ${wallLabel(next)} — the ${effect.everyDays}-day interval counts from this actual time, not from when you enter it.`
      : `Counting ${effect.everyDays} days from this actual time, no later ${peptide} dose falls in this phase.`;
  }
  return `${text}${text ? " " : ""}Entry time is recorded as ${wallLabel(now)}.`;
}

// ── Validation ──────────────────────────────────────────────────────────────

/** The sheet's input, as the server action receives it. */
export type ConfirmForm = {
  requestKey: string;
  key: string;
  seenScheduledAt: string;
  seenDoseMg: string;
  /** The saved-mixture version whose units were shown for the actual time (null: none). */
  seenMixtureVersion: string | null;
  amount: string;
  /** null: now. */
  actual: Wall | null;
  site: string;
  notes: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}:(0|[1-9]\d{0,5}|\d{4}-\d{2}-\d{2})$/;

/** Reads the untrusted input; null when it isn't a confirmation at all. */
export function readConfirmForm(input: unknown): ConfirmForm | null {
  if (typeof input !== "object" || input === null) return null;
  const value = input as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const [requestKey, key, seenScheduledAt, seenDoseMg, amount, site, notes] = [
    "requestKey",
    "key",
    "seenScheduledAt",
    "seenDoseMg",
    "amount",
    "site",
    "notes",
  ].map(text);
  const actual = value.actual === null ? null : typeof value.actual === "string" ? value.actual : undefined;
  const seen = value.seenMixtureVersion;
  const seenMixtureVersion = seen === null ? null : typeof seen === "string" && UUID.test(seen) ? seen.toLowerCase() : undefined;
  if (!requestKey || !UUID.test(requestKey) || !key || !KEY.test(key) || !seenScheduledAt || !seenDoseMg) return null;
  if (amount === null || site === null || notes === null || actual === undefined || seenMixtureVersion === undefined) return null;
  return {
    requestKey: requestKey.toLowerCase(),
    key: key.toLowerCase(),
    seenScheduledAt,
    seenDoseMg,
    seenMixtureVersion,
    amount,
    actual,
    site,
    notes,
  };
}

/**
 * The sheet's checks, first failure wins (the server re-checks the clock and
 * the planned time): amount, then time, then site and notes. `now` is the
 * wall-clock time now in the dose's zone.
 */
export function confirmFormError(form: Pick<ConfirmForm, "amount" | "actual" | "site" | "notes">, now: Wall): string | null {
  const amount = parseDecimal(form.amount);
  if (!amount || !amount.greaterThan(0)) return AMOUNT_REQUIRED;
  if (amount.greaterThan(AMOUNT_LIMIT)) return AMOUNT_TOO_LARGE;
  if (form.actual !== null) {
    if (!isWall(form.actual)) return TIME_REQUIRED;
    if (form.actual > now) return TIME_FUTURE;
  }
  if (form.site !== "" && !RECORDED_SITES.includes(form.site)) return "Choose a site from the list.";
  if (form.notes.trim().length > NOTES_LIMIT) return NOTES_TOO_LONG;
  return null;
}
