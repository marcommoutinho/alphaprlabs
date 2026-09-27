// R10 Supplements and the supplement lines on R1 Today: what the screens show
// (the prototype's R10 view and its Today rows). Pure: built from the
// researcher's routines, Taken records, tracking setting and the library's
// supplied supplement guidance.
//
// Today lists each routine's occurrence today (in its zone): untaken ones
// with a one-tap Taken, taken ones with the time they were taken. A routine
// ended today keeps today's line only when it was taken (R10 shows no Taken
// for an ended routine). Earlier days' untaken occurrences are not listed
// (the prototype shows today's only). Nothing shows while tracking is off.
import { formatDateTime, formatMonthDay } from "@/lib/format";
import type { TodayRow } from "@/lib/doses/today";
import { addDaysToDate, type Wall, wallOf } from "@/lib/doses/rules";
import { type InstantInput, toInstant } from "@/lib/schedule/zone";
import { HISTORY_WINDOW_DAYS } from "./rules";
import { occurrenceOn, type SupplementOccurrence, todayIn } from "./schedule";
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
  ended: boolean;
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

export type SupplementsView = {
  tracking: boolean;
  guidance: GuidanceEntry[];
  /** Active routines by time, then ended ones, most recently ended first. */
  routines: RoutineCard[];
  /** No active routine ("No routines yet …"). */
  empty: boolean;
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
      });
      continue;
    }
    if (routine.endDate !== null) continue;
    rows.push({
      key: o.key,
      kind: "supplement",
      title: routine.name,
      sub: `Supplement · ${o.localTime} · ${routine.amount} ${routine.unit}`,
      status: Date.parse(o.scheduledAt) <= nowMs ? "Due" : "Later today",
      detail: detailOf(routine, o),
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
    const ended = routine.endDate !== null;
    const state = ended
      ? `Ended ${formatMonthDay(routine.endDate!)}`
      : !o
        ? "Active"
        : takenToday
          ? `Taken today ${clock(takenToday.actualAt, routine.timeZone)}`
          : Date.parse(o.scheduledAt) <= nowMs
            ? "Due today"
            : "Later today";
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
      state,
      tone: ended || takenToday ? "quiet" : "active",
      since: `Since ${formatMonthDay(routine.startDate)}`,
      recent: `${recent} recorded in the last 2 weeks`,
      today: !ended && o && !takenToday ? detailOf(routine, o) : null,
      history: [...records].reverse().map((t) => ({
        id: t.id,
        when: formatDateTime(t.actualAt, { timeZone: routine.timeZone }),
        amount: `${t.amount} ${t.unit}`,
        planned: `planned ${clock(t.scheduledAt, routine.timeZone)}`,
      })),
    };
  };

  const active = input.routines.filter((r) => r.endDate === null).sort(byTime);
  const ended = input.routines
    .filter((r) => r.endDate !== null)
    .sort((a, b) => b.endDate!.localeCompare(a.endDate!) || byTime(a, b));
  return {
    tracking: input.tracking,
    guidance: [...input.guidance].filter((g) => g.text.trim()).sort((a, b) => a.name.localeCompare(b.name)),
    routines: input.tracking ? [...active, ...ended].map(card) : [],
    empty: active.length === 0,
  };
}
