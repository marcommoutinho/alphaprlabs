// R10 Supplements and the supplement lines on R1 Today: what the screens show
// (the prototype's R10 view and its Today rows). Pure: built from the
// researcher's routines, Taken records, tracking setting and the library's
// supplied supplement guidance.
//
// Today lists each routine's occurrence today (in its zone): untaken ones
// with a one-tap Taken, taken ones with the time they were taken. A routine
// ended today still runs today (its end date is included), so today's
// untaken occurrence keeps its Taken, on Today and on its R10 card. Earlier
// days' untaken occurrences are not listed (Marco, 2026-09-27: today only).
// Nothing shows while tracking is off. todayNotes words Today's dose-only
// notes so they never contradict a supplement still to take.
import { clock12 } from "@/lib/alpha/format";
import { formatDateTime, formatMonthDay } from "@/lib/format";
import type { TodayRow, TodayView } from "@/lib/doses/today";
import { addDaysToDate, type Wall, wallOf } from "@/lib/doses/rules";
import { type InstantInput, toInstant } from "@/lib/schedule/zone";
import { HISTORY_WINDOW_DAYS, SUPPLEMENT_TIME_ZONE } from "./rules";
import { occurrenceOn, runsOn, type SupplementOccurrence, todayIn } from "./schedule";
import type { Routine, TakenRecord } from "./service";

/** Everything a Taken needs for one occurrence, as shown now. Serializable. */
export type SupplementDetail = {
  key: string;
  routineId: string;
  name: string;
  amount: string;
  unit: string;
  timeZone: string;
  /** Sent back so a changed routine is never recorded blindly (AP020). */
  scheduledAt: string;
  planned: Wall;
  /** "08:00 · 2000 IU" */
  plannedLabel: string;
};

export type SupplementRow = {
  key: string;
  kind: "supplement";
  title: string;
  /** "Supplement · 08:00 · 2000 IU" */
  sub: string;
  /** "Due", "Later today" or "Taken 08:05". */
  status: string;
  /** Untaken: the details a Taken sends; null once taken. */
  detail: SupplementDetail | null;
  /** V1 (the v3 day rail): the planned local time, when it was taken (local "HH:MM"), and "2000 IU". */
  time: string;
  takenTime: string | null;
  amountLabel: string;
  state: "due" | "later" | "taken";
};

export type SupplementToday = { rows: SupplementRow[] };

export type HistoryEntry = {
  id: string;
  /** "Sun Sep 27 · 08:05": when it was taken, in the routine's zone. */
  when: string;
  /** "2000 IU", as recorded. */
  amount: string;
  /** "planned 08:00" */
  planned: string;
};

export type RoutineCard = {
  id: string;
  version: number;
  name: string;
  amount: string;
  unit: string;
  time: string;
  /** Ended by routineEnded (its last day is today or past, or it ended before it started): no edit, no End. */
  ended: boolean;
  /** Its first day is still ahead. */
  upcoming: boolean;
  startDate: string;
  /** The last day it runs (planned or ended), or null. */
  endDate: string | null;
  /** "Vitamin D3 · 2000 IU" */
  title: string;
  /** "Daily · 8:00 AM" */
  schedule: string;
  /** "Since Sep 1", "Since Sep 1 · ends Oct 30", "Starts Oct 1", "Sep 1 – Sep 25" */
  dates: string;
  /** "Ended Sep 27", "Taken today 08:05", "Due today", "Later today" or "Active". */
  state: string;
  tone: "quiet" | "active";
  /** "Since Sep 27" */
  since: string;
  /** "3 recorded in the last 2 weeks" */
  recent: string;
  /** Today's untaken occurrence of an active routine ("Taken today"), else null. */
  today: SupplementDetail | null;
  /** Newest first. */
  history: HistoryEntry[];
};

export type GuidanceEntry = { name: string; text: string };

/** R13 "Today · N of M": today's occurrences, the first one still to take marked as next. */
export type SupplementsTodayList = {
  rows: (SupplementRow & { next: boolean })[];
  taken: number;
  total: number;
};

/** One day of R13's "Last 7 days": taken (ink), missed (dashed), still to take today (outline), or not a day it ran. */
export type GridCell = "taken" | "missed" | "later" | "none";

export type WeekGrid = {
  /** Oldest first; the last one is today. */
  days: { date: string; letter: string; today: boolean }[];
  rows: { routineId: string; name: string; cells: GridCell[] }[];
};

export type SupplementsView = {
  tracking: boolean;
  guidance: GuidanceEntry[];
  /** Active routines by time (upcoming ones included), then ended ones, most recently ended first. */
  routines: RoutineCard[];
  /** No active routine ("No routines yet …"). */
  empty: boolean;
  /** R13's Today list (empty while tracking is off). */
  today: SupplementsTodayList;
  /** R13's "Last 7 days" (no rows while tracking is off). */
  grid: WeekGrid;
};

export type SupplementsInput = {
  tracking: boolean;
  routines: readonly Routine[];
  taken: readonly TakenRecord[];
  now: InstantInput;
};

/** "08:05" of an instant in a zone. */
const clock = (at: string, timeZone: string) => wallOf(at, timeZone).slice(11, 16);

const detailOf = (routine: Routine, o: SupplementOccurrence): SupplementDetail => ({
  key: o.key,
  routineId: routine.id,
  name: routine.name,
  amount: routine.amount,
  unit: routine.unit,
  timeZone: routine.timeZone,
  scheduledAt: o.scheduledAt,
  planned: `${o.localDate}T${o.localTime}`,
  plannedLabel: `${o.localTime} · ${routine.amount} ${routine.unit}`,
});

const byTime = (a: Routine, b: Routine) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Ended (20260928130000_supplies_v3.sql, supplement_routine_ended): its last
 * day is today or past (today it still runs, as its last day), or it ended
 * before it started. A planned end still ahead is not ended.
 */
export const routineEnded = (routine: Pick<Routine, "endDate" | "definitionFrom">, today: string) =>
  routine.endDate !== null && (routine.endDate <= today || routine.endDate < routine.definitionFrom);

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const letterOf = (date: string) => WEEKDAY_LETTERS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/**
 * R13's "Last 7 days", today last: a day with a Taken record is taken; a
 * past occurrence without one is missed; today's untaken occurrence is still
 * to take ("Later today"); any other day is blank. Occurrences are the
 * schedule's (runsOn, ./schedule): from definitionFrom to the end date, so
 * after an edit the days before it are no longer occurrences and stay blank
 * unless a Taken was recorded then (edits apply from now on; past Taken
 * records keep what was recorded). Each routine with an occurrence or a
 * Taken in the week gets a row, by time.
 */
export function weekGrid(routines: readonly Routine[], taken: readonly TakenRecord[], now: InstantInput): WeekGrid {
  const today = todayIn(now, SUPPLEMENT_TIME_ZONE);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysToDate(today, i - 6));
  const takenKeys = new Set(taken.map((t) => `${t.routineId}:${t.localDate}`));
  const rows: WeekGrid["rows"] = [];
  for (const routine of [...routines].sort(byTime)) {
    const routineToday = todayIn(now, routine.timeZone);
    const cells = dates.map((date): GridCell => {
      if (takenKeys.has(`${routine.id}:${date}`)) return "taken";
      if (!runsOn(routine, date)) return "none";
      if (date < routineToday) return "missed";
      return date === routineToday ? "later" : "none";
    });
    if (cells.some((cell) => cell !== "none")) rows.push({ routineId: routine.id, name: routine.name, cells });
  }
  return { days: dates.map((date) => ({ date, letter: letterOf(date), today: date === today })), rows };
}

/** R13's Today list from Today's supplement lines: the first one still to take is next (its Taken is the primary button). */
export function supplementsTodayList(today: SupplementToday): SupplementsTodayList {
  const next = today.rows.find((row) => row.detail !== null)?.key ?? null;
  return {
    rows: today.rows.map((row) => ({ ...row, next: row.key === next })),
    taken: today.rows.filter((row) => row.state === "taken").length,
    total: today.rows.length,
  };
}

/** Today's supplement lines (see the header). */
export function supplementsToday(input: SupplementsInput): SupplementToday {
  if (!input.tracking) return { rows: [] };
  const nowMs = toInstant(input.now).epochMilliseconds;
  const takenByKey = new Map(input.taken.map((t) => [t.occurrenceKey, t]));
  const rows: SupplementRow[] = [];
  for (const routine of [...input.routines].sort(byTime)) {
    const o = occurrenceOn(routine, todayIn(input.now, routine.timeZone));
    if (!o) continue;
    const taken = takenByKey.get(o.key);
    if (taken) {
      rows.push({
        key: o.key,
        kind: "supplement",
        title: routine.name,
        sub: `Supplement · ${clock(taken.scheduledAt, routine.timeZone)} · ${taken.amount} ${taken.unit}`,
        status: `Taken ${clock(taken.actualAt, routine.timeZone)}`,
        detail: null,
        time: clock(taken.scheduledAt, routine.timeZone),
        takenTime: clock(taken.actualAt, routine.timeZone),
        amountLabel: `${taken.amount} ${taken.unit}`,
        state: "taken",
      });
      continue;
    }
    rows.push({
      key: o.key,
      kind: "supplement",
      title: routine.name,
      sub: `Supplement · ${o.localTime} · ${routine.amount} ${routine.unit}`,
      status: Date.parse(o.scheduledAt) <= nowMs ? "Due" : "Later today",
      detail: detailOf(routine, o),
      time: o.localTime,
      takenTime: null,
      amountLabel: `${routine.amount} ${routine.unit}`,
      state: Date.parse(o.scheduledAt) <= nowMs ? "due" : "later",
    });
  }
  return { rows };
}

/** One line of Today's list: a dose (R1) or a supplement. */
export type TodayItem = { type: "dose"; row: TodayRow } | { type: "supplement"; row: SupplementRow };

/**
 * Today's list in the prototype's order: today's doses, today's
 * supplements, then unconfirmed doses and each plan's next dose.
 */
export function mergeTodayRows(doses: readonly TodayRow[], supplements: readonly SupplementRow[]): TodayItem[] {
  return [
    ...doses.filter((row) => row.kind === "today").map((row) => ({ type: "dose" as const, row })),
    ...supplements.map((row) => ({ type: "supplement" as const, row })),
    ...doses.filter((row) => row.kind !== "today").map((row) => ({ type: "dose" as const, row })),
  ];
}

/** R10 (see SupplementsView). `guidance` is the library's supplied supplement guidance. */
export function supplementsView(input: SupplementsInput & { guidance: readonly GuidanceEntry[] }): SupplementsView {
  const nowMs = toInstant(input.now).epochMilliseconds;
  const takenByRoutine = new Map<string, TakenRecord[]>();
  for (const t of input.taken) takenByRoutine.set(t.routineId, [...(takenByRoutine.get(t.routineId) ?? []), t]);

  const card = (routine: Routine): RoutineCard => {
    const today = todayIn(input.now, routine.timeZone);
    const records = takenByRoutine.get(routine.id) ?? [];
    const o = occurrenceOn(routine, today);
    const takenToday = o ? records.find((t) => t.occurrenceKey === o.key) : undefined;
    const ended = routineEnded(routine, today);
    const upcoming = !ended && routine.startDate > today;
    const todayState = !o
      ? null
      : takenToday
        ? `Taken today ${clock(takenToday.actualAt, routine.timeZone)}`
        : Date.parse(o.scheduledAt) <= nowMs
          ? "Due today"
          : "Later today";
    // Ended today: today is still its day (its last).
    const state = ended
      ? todayState
        ? `${todayState} · last day`
        : routine.endDate! < routine.startDate
          ? "Ended before it started"
          : `Ended ${formatMonthDay(routine.endDate!)}`
      : upcoming
        ? `Starts ${formatMonthDay(routine.startDate)}`
        : (todayState ?? "Active");
    const dates = ended
      ? routine.endDate! < routine.startDate
        ? `Planned for ${formatMonthDay(routine.startDate)} · never ran`
        : `${formatMonthDay(routine.startDate)} – ${formatMonthDay(routine.endDate!)}`
      : upcoming
        ? `Starts ${formatMonthDay(routine.startDate)}${routine.endDate ? ` · ends ${formatMonthDay(routine.endDate)}` : ""}`
        : `Since ${formatMonthDay(routine.startDate)}${routine.endDate ? ` · ends ${formatMonthDay(routine.endDate)}` : ""}`;
    const windowStart = addDaysToDate(today, 1 - HISTORY_WINDOW_DAYS);
    const recent = records.filter((t) => t.localDate >= windowStart && t.localDate <= today).length;
    return {
      id: routine.id,
      version: routine.version,
      name: routine.name,
      amount: routine.amount,
      unit: routine.unit,
      time: routine.time,
      ended,
      upcoming,
      startDate: routine.startDate,
      endDate: routine.endDate,
      title: `${routine.name} · ${routine.amount} ${routine.unit}`,
      schedule: `Daily · ${clock12(routine.time)}`,
      dates,
      state,
      tone: !o || takenToday ? "quiet" : "active",
      since: `Since ${formatMonthDay(routine.startDate)}`,
      recent: `${recent} recorded in the last 2 weeks`,
      today: o && !takenToday ? detailOf(routine, o) : null,
      history: [...records].reverse().map((t) => ({
        id: t.id,
        when: formatDateTime(t.actualAt, { timeZone: routine.timeZone }),
        amount: `${t.amount} ${t.unit}`,
        planned: `planned ${clock(t.scheduledAt, routine.timeZone)}`,
      })),
    };
  };

  const isEnded = (r: Routine) => routineEnded(r, todayIn(input.now, r.timeZone));
  const active = input.routines.filter((r) => !isEnded(r)).sort(byTime);
  const ended = input.routines
    .filter(isEnded)
    .sort((a, b) => b.endDate!.localeCompare(a.endDate!) || byTime(a, b));
  const cards = input.tracking ? [...active, ...ended].map(card) : [];
  return {
    tracking: input.tracking,
    guidance: [...input.guidance].filter((g) => g.text.trim()).sort((a, b) => a.name.localeCompare(b.name)),
    routines: cards,
    // Nothing running, and nothing left to take today.
    empty: active.length === 0 && !cards.some((c) => c.today),
    today: supplementsTodayList(supplementsToday(input)),
    grid: input.tracking ? weekGrid(input.routines, input.taken, input.now) : { ...weekGrid([], [], input.now), rows: [] },
  };
}

// ── Today's notes beside supplements ────────────────────────────────────────

/** R9a "No cycle running" body (design v3). */
export const NO_CYCLES_BODY = "Build one from scratch, or start from a template the team maintains and adjust it.";
/** The same, above a supplement still to take today (only peptide doses wait for a plan). */
export const NO_CYCLES_BODY_SUPPLEMENTS = "Build one from scratch, or start from a template the team maintains. Peptide doses appear once a plan exists.";
/** The prototype's quiet titles, and what they say while a supplement is still to take today. */
const QUIET_WITH_SUPPLEMENTS: Record<string, string> = {
  "All done for today": "Doses done for today",
  "Nothing due today": "No doses due today",
};

export type TodayNotes = {
  /** The "No cycles yet" card's body (shown only without cycles). */
  noCyclesBody: string;
  /** The quiet card, or null. */
  nothingDue: { title: string; body: string } | null;
};

/**
 * Today's dose-only notes in the prototype's wording, except that none of
 * them says nothing is due, or all is done, above a supplement still to take
 * today: the dose wording then names doses.
 */
export function todayNotes(doses: Pick<TodayView, "nothingDue">, supplements: SupplementToday): TodayNotes {
  const pending = supplements.rows.some((row) => row.detail !== null);
  const quiet = doses.nothingDue;
  return {
    noCyclesBody: pending ? NO_CYCLES_BODY_SUPPLEMENTS : NO_CYCLES_BODY,
    nothingDue: quiet && pending ? { ...quiet, title: QUIET_WITH_SUPPLEMENTS[quiet.title] ?? quiet.title } : quiet,
  };
}
