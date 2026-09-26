// Wall-clock ↔ instant conversion in a named IANA time zone, using the pinned
// Temporal polyfill (Node 22 has no native Temporal).
//
// Plan rule (D4 refinement): a nonexistent local time (spring-forward gap)
// shifts forward by the gap; a local time that occurs twice (fall-back
// repeat) uses the earlier instant. That is Temporal's "compatible"
// disambiguation.
import { Temporal } from "@js-temporal/polyfill";

/** Calendar date in the plan's zone, "YYYY-MM-DD". */
export type LocalDate = string;
/** Wall-clock time in the plan's zone, "HH:MM" (24-hour). */
export type LocalTime = string;
/** An instant: a Date, or an ISO 8601 string with an offset or "Z". */
export type InstantInput = Date | string;

/** How a wall-clock time was resolved across a daylight-saving change. */
export type DstAdjustment = "gap" | "repeat" | null;

export type ResolvedTime = {
  instant: Temporal.Instant;
  /** "gap": the requested time didn't exist and was shifted forward by the gap. "repeat": it occurred twice; the earlier was used. */
  dstAdjustment: DstAdjustment;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real calendar date written "YYYY-MM-DD". */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

/** True for a 24-hour wall-clock time written "HH:MM" (00:00–23:59). */
export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === "string" && TIME.test(value);
}

/** True for an IANA time zone name this runtime knows (e.g. "America/Toronto"). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    Temporal.PlainDate.from("2026-01-01").toZonedDateTime({ timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Parses an instant input. Throws RangeError for a string without an offset. */
export function toInstant(value: InstantInput): Temporal.Instant {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) throw new RangeError("Invalid Date");
    return Temporal.Instant.fromEpochMilliseconds(ms);
  }
  return Temporal.Instant.from(value);
}

/** Resolves a wall-clock date and time in a zone to an instant, per the plan's DST rule. */
export function resolveWallClock(dateTime: Temporal.PlainDateTime, timeZone: string): ResolvedTime {
  const zoned = dateTime.toZonedDateTime(timeZone, { disambiguation: "compatible" });
  let dstAdjustment: DstAdjustment = null;
  if (!zoned.toPlainDateTime().equals(dateTime)) {
    dstAdjustment = "gap";
  } else {
    const later = dateTime.toZonedDateTime(timeZone, { disambiguation: "later" });
    if (later.epochNanoseconds !== zoned.epochNanoseconds) dstAdjustment = "repeat";
  }
  return { instant: zoned.toInstant(), dstAdjustment };
}

/** Resolves "YYYY-MM-DD" + "HH:MM" in a zone. */
export function resolveLocal(date: LocalDate, time: LocalTime, timeZone: string): ResolvedTime {
  return resolveWallClock(Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(time)), timeZone);
}

/** The wall-clock date and time of an instant in a zone. */
export function wallClock(instant: Temporal.Instant, timeZone: string): Temporal.PlainDateTime {
  return instant.toZonedDateTimeISO(timeZone).toPlainDateTime();
}

/** The local calendar date of an instant in a zone. */
export function localDateOf(instant: InstantInput | Temporal.Instant, timeZone: string): LocalDate {
  const value = instant instanceof Temporal.Instant ? instant : toInstant(instant);
  return value.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** "HH:MM" of a wall-clock date-time. */
export function formatLocalTime(dateTime: Temporal.PlainDateTime): LocalTime {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dateTime.hour)}:${pad(dateTime.minute)}`;
}

/** The first instant of the local day after `date` in the zone (the end of that day). */
export function endOfLocalDay(date: LocalDate, timeZone: string): Temporal.Instant {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
}

/** ISO 8601 UTC string with "Z", e.g. "2026-09-02T00:05:00Z". */
export function isoInstant(instant: Temporal.Instant): string {
  return instant.toString();
}
