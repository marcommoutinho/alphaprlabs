// V2 Cycles in design v3: what R10 (the list), R3 / D2 (a cycle) and the
// full history show, from a cycle's revisions, its recorded doses and skips
// (as confirmations) and its plans' saved mixtures. Pure and client-safe;
// unit-tested (tests/unit/cycle-screens.test.ts).
//
// Doses always come from the engine across every revision
// (planOccurrences, schedule.ts), exactly as Today and the server resolve
// them; adherence is ./adherence.ts. Times are each dose's own local date
// and time, in the zone of the revision that scheduled it.
import { clock12, massLabel, shortDate, weekdayOf } from "@/lib/alpha/format";
import { drawDisplay } from "@/lib/doses/rules";
import { concentrationOf, type Mixture } from "@/lib/mixtures/rules";
import { type ActivePhase, type Occurrence, occurrenceState, type Phase, timeOn } from "@/lib/schedule/engine";
import { type InstantInput, localDateOf, toInstant, wallClock } from "@/lib/schedule/zone";
import { type Adherence, adherence, adherenceCount, percentLabel } from "./adherence";
import { type AxisLabel, axisLabels, dateRange, daysBetween, daysLabel, type LaneBar, laneBars, monthDay, tickGeometry } from "./geometry";
import { type CycleRecord, doseAt } from "./rules";
import { type CycleStatus, cycleSpan, cycleStatus, planOccurrences } from "./schedule";
import type { RecordedConfirmation, ViewPeptides } from "./views";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Mon … Sun. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const nameOf = (peptides: ViewPeptides, id: string | undefined) => (id && peptides.get(id)?.name) || "Unknown peptide";

/** "A", "A and B", "A, B and C". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "daily", "every 2 days", "Mon and Thu", "Mon, Wed and Fri". */
export function scheduleWords(phase: ActivePhase): string {
  if (phase.schedule.type === "interval") return phase.schedule.everyDays === 1 ? "daily" : `every ${phase.schedule.everyDays} days`;
  const days = WEEK_ORDER.filter((d) => (phase.schedule as { days: number[] }).days.includes(d)).map((d) => WEEKDAYS[d]);
  return days.length === 7 ? "daily" : andList(days);
}

/** "Wed 8:00 PM": a dose's weekday and planned time. */
export const plannedWhen = (o: Pick<Occurrence, "localDate" | "localTime">) => `${weekdayOf(o.localDate)} ${clock12(o.localTime)}`;

/** "HH:MM" and the local date of an instant in a zone. */
function wall(at: string, timeZone: string): { date: string; time: string } {
  const dt = wallClock(toInstant(at), timeZone);
  return { date: dt.toPlainDate().toString(), time: `${String(dt.hour).padStart(2, "0")}:${String(dt.minute).padStart(2, "0")}` };
}

type CycleData = {
  status: CycleStatus;
  start: string;
  end: string;
  total: number;
  /** Today's 1-based day (≤ 0 before the start, > total after the end). */
  day: number;
  today: string;
  timeZone: string;
  byPlan: Map<string, Occurrence[]>;
  all: Occurrence[];
  adherence: Adherence;
};

function cycleData(cycle: CycleRecord, confirmations: readonly RecordedConfirmation[], now: InstantInput): CycleData {
  const revision = cycle.revisions[cycle.revisions.length - 1];
  const { start, end } = cycleSpan(revision);
  const today = localDateOf(toInstant(now), revision.timeZone);
  const byPlan = planOccurrences(cycle.revisions, confirmations);
  const all = [...byPlan.values()].flat().sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.key.localeCompare(b.key));
  return {
    status: cycleStatus(revision, now),
    start,
    end,
    total: daysBetween(start, end) + 1,
    day: daysBetween(start, today) + 1,
    today,
    timeZone: revision.timeZone,
    byPlan,
    all,
    adherence: adherence(all, now),
  };
}

// ── R10 Cycles ──────────────────────────────────────────────────────────────

export type CycleGroup = "active" | "upcoming" | "ended";

export type CycleCard = {
  id: string;
  name: string;
  status: CycleStatus;
  group: CycleGroup;
  /** "BPC-157 · TB-500" */
  peptides: string;
  total: number;
  day: number;
  /** "Day 24 of 84" */
  dayLabel: string;
  /** "Sep 1", "Nov 23" (the ruler's ends). */
  startLabel: string;
  endLabel: string;
  /** "Starts Nov 30" (upcoming). */
  startsLabel: string;
  /** "42 days" */
  lengthLabel: string;
  /** "Jan 5 – Mar 29" (ended rows; the year when it isn't this one). */
  rangeLabel: string;
  /** The next dose to take: "TB-500 · 2.5 mg" and "due now" / "due at 8:00 PM" / "next Thu 8:00 PM". */
  next: { title: string; when: string; due: boolean } | null;
  /** "96%" or "—". */
  adherence: string;
  missed: number;
};

/** The next dose still to take: today's first open one, else the first planned one. */
function nextDose(all: readonly Occurrence[], now: InstantInput): { o: Occurrence; due: boolean } | null {
  for (const o of all) {
    const state = occurrenceState(o, now);
    if (state === "due") return { o, due: true };
    if (state === "planned") return { o, due: false };
  }
  return null;
}

function nextWhen(o: Occurrence, due: boolean, now: InstantInput): string {
  if (due) return Date.parse(o.scheduledAt) <= toInstant(now).epochMilliseconds ? "due now" : `due at ${clock12(o.localTime)}`;
  const today = localDateOf(toInstant(now), o.timeZone);
  const days = daysBetween(today, o.localDate);
  if (days === 1) return `next tomorrow ${clock12(o.localTime)}`;
  return days < 7 ? `next ${plannedWhen(o)}` : `next ${shortDate(o.localDate)}`;
}

/** One R10 card or row. `confirmations` are the cycle's recorded doses and skips. */
export function cycleCard(cycle: CycleRecord, confirmations: readonly RecordedConfirmation[], peptides: ViewPeptides, now: InstantInput): CycleCard {
  const data = cycleData(cycle, confirmations, now);
  const revision = cycle.revisions[cycle.revisions.length - 1];
  const planPeptide = new Map(cycle.revisions.flatMap((r) => r.plans.map((plan) => [plan.planId, plan.peptideId] as const)));
  const next = nextDose(data.all, now);
  const year = toInstant(now).toString().slice(0, 4);
  return {
    id: cycle.id,
    name: cycle.name,
    status: data.status,
    group: data.status === "Upcoming" ? "upcoming" : data.status === "Ended" ? "ended" : "active",
    peptides: revision.plans.map((plan) => nameOf(peptides, plan.peptideId)).join(" · "),
    total: data.total,
    day: data.day,
    dayLabel: `Day ${Math.min(Math.max(data.day, 1), data.total)} of ${data.total}`,
    startLabel: monthDay(data.start),
    endLabel: monthDay(data.end),
    startsLabel: `Starts ${monthDay(data.start)}`,
    lengthLabel: `${data.total} day${data.total === 1 ? "" : "s"}`,
    rangeLabel: dateRange(data.start, data.end, year),
    next: next
      ? { title: `${nameOf(peptides, planPeptide.get(next.o.planId))} · ${massLabel(next.o.doseMg)}`, when: nextWhen(next.o, next.due, now), due: next.due }
      : null,
    adherence: percentLabel(data.adherence),
    missed: data.adherence.missed,
  };
}

/** R10's groups in order (Active includes cycles in a break); empty ones are left out. */
export function groupCards(cards: readonly CycleCard[]): { group: CycleGroup; label: string; cards: CycleCard[] }[] {
  const groups: { group: CycleGroup; label: string }[] = [
    { group: "active", label: "Active" },
    { group: "upcoming", label: "Upcoming" },
    { group: "ended", label: "Ended" },
  ];
  return groups.map((g) => ({ ...g, cards: cards.filter((card) => card.group === g.group) })).filter((g) => g.cards.length > 0);
}

// ── R3 / D2 Cycle detail ────────────────────────────────────────────────────

export type PhaseLine = {
  key: string;
  /** "Days 1–56" */
  days: string;
  /** "Sep 1 – Oct 26" */
  dates: string;
  /** "250 mcg", or "Break". */
  amount: string;
  kind: "active" | "break";
  when: "done" | "now" | "next";
};

export type PlanView = {
  planId: string;
  name: string;
  notOffered: boolean;
  /** Supplied cycling-off guidance, if any. */
  guidance: string;
  /** "45 of 47" */
  count: string;
  /** "250 mcg · daily · 7:30 AM", or "Break until Tue, Oct 12". */
  schedule: string;
  /** D2's label column: "daily · 7:30 AM", "Mon and Thu · 9:00 AM", or the break line. */
  cadence: string;
  bars: LaneBar[];
  phases: PhaseLine[];
  /** The saved mixture: "10 mg + 2 mL · 5 mg/mL" and "5 units · 30-unit"; null without one. */
  mix: { setup: string; concentration: string; units: string | null; draw: string | null } | null;
};

export type HistoryItem = {
  key: string;
  state: "taken" | "missed" | "skipped" | "due";
  peptide: string;
  /** What was taken ("250 mcg"), else the planned dose. */
  amount: string;
  /** The planned dose when a different amount was taken ("400 mcg"), shown quietly; else null. */
  planned: string | null;
  /** "Thu, Sep 24" */
  date: string;
  /** "7:34 AM" taken; "planned 8:00 PM" otherwise. */
  time: string;
  site: string;
  note: string;
  /** The R2b log-late sheet (missed) or the log sheet (due), on Today. */
  logHref: string | null;
};

export type CycleScreen = {
  id: string;
  name: string;
  status: CycleStatus;
  /** "Active · Sep 1 – Nov 23" */
  header: string;
  /** "BPC-157 and TB-500 · from the Recovery stack template" */
  subtitle: string;
  /** "from Recovery stack" (D2's header), or "". */
  from: string;
  goal: string;
  baseline: string;
  timeZone: string;
  now: { label: string; value: string; unit: string; right: string; rightSub: string };
  ticks: { total: number; day: number; labels: AxisLabel[] };
  tiles: {
    adherence: { value: string; unit: string; context: string; short: string };
    missed: { count: number; context: string };
    skipped: { count: number; context: string };
  };
  plans: PlanView[];
  /** The laptop timeline's axis (months) and today line (%, or null). */
  axis: AxisLabel[];
  todayPercent: number | null;
  /** Newest first: every dose taken, skipped or missed, and today's. */
  history: HistoryItem[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The active phase whose dose and time the card's line shows: today's, else the next, else the last. */
export function currentActive(phases: readonly Phase[], today: string): ActivePhase | null {
  const active = phases.filter((phase): phase is ActivePhase => phase.kind === "active").sort((a, b) => a.start.localeCompare(b.start));
  return active.find((p) => p.start <= today && p.end >= today) ?? active.find((p) => p.start > today) ?? active[active.length - 1] ?? null;
}

function planView(
  plan: CycleRecord["revisions"][number]["plans"][number],
  data: CycleData,
  peptides: ViewPeptides,
  mixture: Mixture | null,
  now: InstantInput,
): PlanView {
  const peptide = peptides.get(plan.peptideId);
  const today = data.today;
  const active = currentActive(plan.phases, today);
  const on = active ? (today < active.start ? active.start : today > active.end ? active.end : today) : today;
  const dose = active ? doseAt(active, on) : null;
  const time = active ? clock12(timeOn(active, on)) : "";
  const inBreak = plan.phases.find((p) => p.kind === "break" && p.start <= today && p.end >= today);
  const schedule = inBreak
    ? `Break until ${shortDate(inBreak.end)}`
    : active && dose
      ? `${massLabel(dose)} · ${scheduleWords(active)} · ${time}`
      : "";
  const bars = laneBars(plan.phases, data.start, data.total);
  const phases: PhaseLine[] = bars.map((bar, i) => ({
    key: `${bar.phaseId}:${i}`,
    days: daysLabel(bar.from, bar.to),
    dates: dateRange(bar.firstDate, bar.lastDate),
    amount: bar.doseMg === null ? "Break" : massLabel(bar.doseMg),
    kind: bar.kind,
    when: bar.lastDate < today ? "done" : bar.firstDate <= today ? "now" : "next",
  }));
  const stats = adherence(data.byPlan.get(plan.planId) ?? [], now);
  let mix: PlanView["mix"] = null;
  if (mixture) {
    const { setup } = mixture;
    const draw = dose ? drawDisplay(setup, dose) : null;
    mix = {
      setup: `${setup.vialMg} mg + ${setup.liquidMl} mL · ${concentrationOf(setup)} mg/mL`,
      concentration: `${concentrationOf(setup)} mg/mL`,
      units: draw?.kind === "units" ? `${draw.units} units` : null,
      draw: draw?.kind === "units" ? `${draw.units} units · ${setup.syringe}-unit` : null,
    };
  }
  return {
    planId: plan.planId,
    name: nameOf(peptides, plan.peptideId),
    notOffered: Boolean(peptide && !peptide.available),
    guidance: peptide?.cyclingOff ?? "",
    count: adherenceCount(stats, false),
    schedule,
    cadence: inBreak ? schedule : active ? `${scheduleWords(active)} · ${time}` : "",
    bars,
    phases,
    mix,
  };
}

/**
 * Everything R3 and D2 show for one cycle as of `now`. `mixtures` are the
 * saved mixture each plan uses now, by plan id.
 */
export function cycleScreen(
  cycle: CycleRecord,
  confirmations: readonly RecordedConfirmation[],
  peptides: ViewPeptides,
  mixtures: ReadonlyMap<string, Mixture>,
  now: InstantInput,
): CycleScreen {
  const data = cycleData(cycle, confirmations, now);
  const revision = cycle.revisions[cycle.revisions.length - 1];
  const { status, total, day, start, end } = data;
  const recorded = new Map(confirmations.map((c) => [c.key, c]));
  const planPeptide = new Map(cycle.revisions.flatMap((r) => r.plans.map((plan) => [plan.planId, plan.peptideId] as const)));

  const nowBlock: CycleScreen["now"] =
    status === "Upcoming"
      ? { label: "Starts in", value: String(1 - day), unit: 1 - day === 1 ? "day" : "days", right: plural(total, "day"), rightSub: `Starts ${shortDate(start)}` }
      : status === "Ended"
        ? { label: "Ended", value: String(total), unit: total === 1 ? "day" : "days", right: `${percentLabel(data.adherence)} adherence`, rightSub: `Ended ${shortDate(end)}` }
        : {
            label: "Day",
            value: String(day),
            unit: `of ${total}`,
            right: total - day === 0 ? "Last day" : `${plural(total - day, "day")} left`,
            rightSub: `Ends ${shortDate(end)}`,
          };

  const a = data.adherence;
  const history: HistoryItem[] = data.all
    .map((o) => ({ o, state: occurrenceState(o, now) }))
    .filter(({ state }) => state !== "planned")
    .reverse()
    .map(({ o, state }): HistoryItem => {
      const record = recorded.get(o.key);
      const peptide = nameOf(peptides, planPeptide.get(o.planId));
      const log = `/app/today?dose=${encodeURIComponent(o.key)}`;
      if (state === "taken" && o.actualAt) {
        const at = wall(o.actualAt, o.timeZone);
        return {
          key: o.key,
          state: "taken",
          peptide,
          amount: massLabel(record?.amountMg ?? o.doseMg),
          planned: record?.amountMg && massLabel(record.amountMg) !== massLabel(o.doseMg) ? massLabel(o.doseMg) : null,
          date: shortDate(at.date),
          time: clock12(at.time),
          site: record?.site ?? "",
          note: record?.notes ?? "",
          logHref: null,
        };
      }
      const kind = state === "skipped" ? "skipped" : state === "open" ? "missed" : "due";
      return {
        key: o.key,
        state: kind,
        peptide,
        amount: massLabel(o.doseMg),
        planned: null,
        date: shortDate(o.localDate),
        time: `planned ${clock12(o.localTime)}`,
        site: "",
        note: "",
        logHref: kind === "skipped" ? null : log,
      };
    });

  return {
    id: cycle.id,
    name: cycle.name,
    status,
    header: `${status} · ${dateRange(start, end)}`,
    subtitle: [andList(revision.plans.map((plan) => nameOf(peptides, plan.peptideId))), cycle.templateName ? `from the ${cycle.templateName} template` : ""]
      .filter(Boolean)
      .join(" · "),
    from: cycle.templateName ? `from ${cycle.templateName}` : "",
    goal: cycle.goal,
    baseline: cycle.baseline,
    timeZone: revision.timeZone,
    now: nowBlock,
    ticks: { total, day, labels: axisLabels(start, end, status === "Upcoming" || status === "Ended" ? null : data.today) },
    tiles: {
      adherence: {
        value: a.percent === null ? "—" : String(a.percent),
        unit: a.percent === null ? "" : "%",
        context: adherenceCount(a),
        short: adherenceCount(a, false),
      },
      missed: { count: a.missed, context: a.lastMissed ? plannedWhen(a.lastMissed) : "None" },
      skipped: { count: a.skipped, context: a.lastSkipped ? shortDate(a.lastSkipped.localDate) : "None" },
    },
    plans: revision.plans.map((plan) => planView(plan, data, peptides, mixtures.get(plan.planId) ?? null, now)),
    axis: axisLabels(start, end, null, { minGap: 10 }),
    todayPercent: tickGeometry(total, day).today,
    history,
  };
}
