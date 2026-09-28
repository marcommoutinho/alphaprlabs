// R1 Today (design v3): the day's progress, the overdue line and the day
// rail, from todayView's items and today's supplement lines. Pure and
// client-safe.
//
// Progress counts every item scheduled today, the check-in included: done
// (a dose taken or skipped: a skip counts as resolved, not missed; a
// supplement taken; the check-in saved), due (due now, not yet done) or
// the rest. Unconfirmed doses from earlier days are not today's items: they
// are the overdue count beside it.
import { addDaysToDate } from "./rules";
import type { TodayDose } from "./today";
import type { SupplementRow } from "@/lib/supplements/view";

export type Segment = "done" | "due" | "rest";

export type DayProgress = {
  /** One per item, done first, then due, then the rest (the bar fills from the left). */
  segments: Segment[];
  done: number;
  total: number;
  /** "2 of 7 done" */
  label: string;
  overdue: number;
  /** "1 overdue from yesterday", "3 overdue", or null. */
  overdueLabel: string | null;
};

type DoseLike = Pick<TodayDose, "kind" | "state" | "scheduledAt" | "localDate">;
type SupplementLike = Pick<SupplementRow, "state">;

const doseSegment = (dose: DoseLike, nowMs: number): Segment =>
  dose.state === "taken" || dose.state === "skipped" ? "done" : dose.state === "due" && Date.parse(dose.scheduledAt) <= nowMs ? "due" : "rest";

const supplementSegment = (row: SupplementLike): Segment => (row.state === "taken" ? "done" : row.state === "due" ? "due" : "rest");

/** The header's progress (see the file header). `today` is the header's local date. */
export function dayProgress(input: {
  doses: readonly DoseLike[];
  supplements: readonly SupplementLike[];
  checkedIn: boolean;
  today: string;
  now: Date | string;
}): DayProgress {
  const nowMs = typeof input.now === "string" ? Date.parse(input.now) : input.now.getTime();
  const segments: Segment[] = [
    ...input.doses.filter((d) => d.kind === "today").map((d) => doseSegment(d, nowMs)),
    ...input.supplements.map(supplementSegment),
    input.checkedIn ? "done" : "rest",
  ];
  const order: Record<Segment, number> = { done: 0, due: 1, rest: 2 };
  segments.sort((a, b) => order[a] - order[b]);
  const done = segments.filter((s) => s === "done").length;
  const open = input.doses.filter((d) => d.kind === "open");
  const yesterday = addDaysToDate(input.today, -1);
  const overdueLabel = open.length
    ? open.every((d) => d.localDate === yesterday)
      ? `${open.length} overdue from yesterday`
      : `${open.length} overdue`
    : null;
  return { segments, done, total: segments.length, label: `${done} of ${segments.length} done`, overdue: open.length, overdueLabel };
}

export type RailEntry = { type: "dose"; key: string; time: string; dose: TodayDose } | { type: "supplement"; key: string; time: string; row: SupplementRow };

/** The Schedule rail: today's doses and supplements in time order (a dose first at the same minute). */
export function dayRail(doses: readonly TodayDose[], supplements: readonly SupplementRow[]): RailEntry[] {
  const entries: RailEntry[] = [
    ...doses.filter((d) => d.kind === "today").map((dose) => ({ type: "dose" as const, key: `dose/${dose.key}`, time: dose.localTime, dose })),
    ...supplements.map((row) => ({ type: "supplement" as const, key: `supplement/${row.key}`, time: row.time, row })),
  ];
  const rank = (e: RailEntry) => (e.type === "dose" ? 0 : 1);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.time.localeCompare(b.entry.time) || rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}
