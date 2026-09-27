// R1 Today: what the screen shows, derived from the researcher's cycles, their
// recorded doses and saved mixtures (handoff R1 and the prototype's Today and
// Confirm views). Pure and shared by the page, the badge and the tests.
//
// Doses always come from the engine across every revision of each cycle
// (planOccurrences), with the recorded doses as confirmations, so an
// every-N-days dose confirmed late or backdated moves only the doses still
// ahead, and fixed weekdays stay put. States are by local date in each
// dose's own zone (the engine's occurrenceState): due (today), open (an
// earlier day, "Unconfirmed"), planned (a later day), taken.
//
// Today lists: the hero (the earliest unconfirmed dose dated today), today's
// other doses, unconfirmed doses from cycles that have not ended (newest
// first; an ended cycle's stay open in its history, R4), then each plan's
// next dose on a later day (plan: "upcoming doses"; the prototype showed only
// the first). The badge counts doses awaiting confirmation (their time has
// come, not taken) in cycles that have not ended: exactly the ones Today
// asks the researcher to confirm.
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { occurrenceWhen, STATE_LABEL, type ViewPeptides } from "@/lib/cycles/views";
import { SYRINGE_LABEL } from "@/lib/calculator/calculator";
import { formatDateTime } from "@/lib/format";
import type { Mixture } from "@/lib/mixtures/rules";
import {
  type Confirmation,
  isAwaitingConfirmation,
  type Occurrence,
  occurrenceState,
  type OccurrenceState,
  type Phase,
} from "@/lib/schedule/engine";
import { type InstantInput, toInstant } from "@/lib/schedule/zone";
import { drawDisplay, type DrawDisplay, type DrawSetup, type ScheduleEffect, STALE_LINK, unitsLabel, type Wall, wallOf } from "./rules";

/** Everything the sheet needs for one dose, as shown now. Serializable. */
export type DoseDetail = {
  key: string;
  planId: string;
  cycleId: string;
  peptideName: string;
  cycleName: string;
  timeZone: string;
  /** The occurrence as scheduled now (ISO) and its planned dose: sent back so a changed dose is never confirmed blindly. */
  scheduledAt: string;
  doseMg: string;
  planned: Wall;
  plannedLabel: string;
  state: OccurrenceState;
  stateLabel: string;
  setup: DrawSetup | null;
  /** `8 mg / 2 mL` and `1 mL`, when there is a saved mixture. */
  mixtureLabel: string;
  syringeLabel: string;
  /** The tracked open vial of the plan's mixture, when supply tracking is on. */
  vialLabel: string | null;
  effect: ScheduleEffect;
  /** When already confirmed: the actual and entered times, in the dose's zone. */
  recorded: { actual: string; entered: string } | null;
  calculatorHref: string;
};

export type TodayHero = {
  key: string;
  dueWord: "Due" | "Later today";
  time: string;
  cycleName: string;
  peptideName: string;
  doseMg: string;
  draw: DrawDisplay;
  mixtureLabel: string;
  syringeLabel: string;
  calculatorHref: string;
};

export type TodayRow = {
  key: string;
  kind: "today" | "open" | "next";
  title: string;
  sub: string;
  status: string;
  /** "Taken" confirms in one tap; "Confirm" opens the sheet. */
  action: "Taken" | "Confirm" | null;
};

export type TodayView = {
  /** `Saturday, September 26` and the zone it is in. */
  dateLabel: string;
  timeZone: string;
  hasCycles: boolean;
  hero: TodayHero | null;
  nothingDue: { title: string; body: string } | null;
  rows: TodayRow[];
  /** Doses awaiting confirmation (the app icon badge). */
  badge: number;
  /** The sheet's details, by occurrence key, for every dose on the screen (and the requested one). */
  doses: Record<string, DoseDetail>;
  /** `?dose=<key>` (a notification tap): open this dose's sheet, or say why not. */
  requested: { key: string; notice: string | null } | null;
};

export type TodayInput = {
  cycles: readonly CycleRecord[];
  /** Recorded doses as confirmations, by cycle id. */
  confirmations: ReadonlyMap<string, readonly Confirmation[]>;
  /** When each recorded dose was entered, by occurrence key. */
  recordedAt: ReadonlyMap<string, string>;
  peptides: ViewPeptides;
  /** The saved mixture each plan uses now, by plan id. */
  mixtures: ReadonlyMap<string, Mixture>;
  /** Open tracked vial labels by mixture id (empty while tracking is off). */
  vials: ReadonlyMap<string, string>;
  now: InstantInput;
  /** The requested occurrence key (`?dose=`), if any. */
  requestedKey?: string | null;
};

type Entry = { o: Occurrence; state: OccurrenceState; cycle: CycleRecord; ended: boolean; peptideId: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Mon … Sun, the builder's order. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const at = (o: Occurrence) => Date.parse(o.scheduledAt);
const indexOf = (o: Occurrence) => Number(o.key.split(":")[2]);

/** `Saturday, September 26` for a wall-clock date. */
function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The phase an occurrence belongs to, as the newest revision holding it has it. */
function phaseOf(cycle: CycleRecord, planId: string, phaseId: string): Phase | null {
  for (const revision of [...cycle.revisions].reverse()) {
    const phase = revision.plans.find((plan) => plan.planId === planId)?.phases.find((p) => p.id === phaseId);
    if (phase) return phase;
  }
  return null;
}

function effectOf(cycle: CycleRecord, o: Occurrence, planOccurrences: readonly Occurrence[], nowMs: number): ScheduleEffect {
  const phase = phaseOf(cycle, o.planId, o.phaseId);
  if (!phase || phase.kind !== "active" || phase.schedule.type === "weekdays") {
    const days = phase?.kind === "active" && phase.schedule.type === "weekdays" ? phase.schedule.days : [];
    return { kind: "weekdays", days: WEEK_ORDER.filter((d) => days.includes(d as never)).map((d) => WEEKDAYS[d]).join("/"), time: o.localTime };
  }
  const siblings = planOccurrences.filter((x) => x.phaseId === o.phaseId);
  const k = indexOf(o);
  const next = siblings.find((x) => indexOf(x) === k + 1);
  const floor = siblings
    .filter((x) => indexOf(x) < k && x.actualAt)
    .reduce<string | null>((latest, x) => (!latest || Date.parse(x.actualAt!) > Date.parse(latest) ? x.actualAt : latest), null);
  return {
    kind: "interval",
    everyDays: phase.schedule.everyDays,
    phaseEnd: phase.end,
    timeChanges: (phase.timeChanges ?? []).map((c) => ({ from: c.from, time: c.time })),
    floor: floor ? wallOf(floor, o.timeZone) : null,
    next: !next ? "none" : !next.actualAt && at(next) > nowMs ? "moves" : "kept",
  };
}

/** Everything R1 shows as of `now`. */
export function todayView(input: TodayInput): TodayView {
  const now = toInstant(input.now);
  const nowMs = now.epochMilliseconds;
  const entries: Entry[] = [];
  const byPlan = new Map<string, { cycle: CycleRecord; occurrences: Occurrence[] }>();
  const current = input.cycles.filter((cycle) => cycle.revisions.length > 0);
  for (const cycle of current) {
    const revision = cycle.revisions[cycle.revisions.length - 1];
    const ended = cycleStatus(revision, now.toString()) === "Ended";
    const peptideOf = new Map(cycle.revisions.flatMap((r) => r.plans.map((plan) => [plan.planId, plan.peptideId] as const)));
    for (const [planId, occurrences] of planOccurrences(cycle.revisions, input.confirmations.get(cycle.id) ?? [])) {
      byPlan.set(planId, { cycle, occurrences });
      for (const o of occurrences) {
        entries.push({ o, state: occurrenceState(o, now.toString()), cycle, ended, peptideId: peptideOf.get(planId) ?? "" });
      }
    }
  }
  entries.sort((a, b) => at(a.o) - at(b.o) || a.o.key.localeCompare(b.o.key));

  const nameOf = (entry: Entry) => input.peptides.get(entry.peptideId)?.name || "Unknown peptide";
  const mixtureOf = (entry: Entry) => input.mixtures.get(entry.o.planId) ?? null;
  const setupOf = (entry: Entry): DrawSetup | null => mixtureOf(entry)?.setup ?? null;
  const drawOf = (entry: Entry) => drawDisplay(setupOf(entry), entry.o.doseMg);

  const doses: Record<string, DoseDetail> = {};
  const detail = (entry: Entry): DoseDetail => {
    const { o } = entry;
    const mixture = mixtureOf(entry);
    const recordedAt = input.recordedAt.get(o.key);
    const value: DoseDetail = {
      key: o.key,
      planId: o.planId,
      cycleId: entry.cycle.id,
      peptideName: nameOf(entry),
      cycleName: entry.cycle.name,
      timeZone: o.timeZone,
      scheduledAt: o.scheduledAt,
      doseMg: o.doseMg,
      planned: `${o.localDate}T${o.localTime}`,
      plannedLabel: occurrenceWhen(o),
      state: entry.state,
      stateLabel: STATE_LABEL[entry.state],
      setup: mixture?.setup ?? null,
      mixtureLabel: mixture ? `${mixture.setup.vialMg} mg / ${mixture.setup.liquidMl} mL` : "",
      syringeLabel: mixture ? SYRINGE_LABEL[mixture.setup.syringe] : "",
      vialLabel: mixture ? (input.vials.get(mixture.id) ?? null) : null,
      effect: effectOf(entry.cycle, o, byPlan.get(o.planId)?.occurrences ?? [], nowMs),
      recorded:
        o.actualAt && recordedAt
          ? { actual: formatDateTime(o.actualAt, { timeZone: o.timeZone }), entered: formatDateTime(recordedAt, { timeZone: o.timeZone }) }
          : null,
      calculatorHref: `/app/calculator?plan=${o.planId}`,
    };
    doses[o.key] = value;
    return value;
  };

  const today = entries.filter((e) => e.state === "due" || (e.o.actualAt && e.o.localDate === wallOf(now.toString(), e.o.timeZone).slice(0, 10)));
  const heroEntry = today.find((e) => !e.o.actualAt) ?? null;
  const open = entries.filter((e) => e.state === "open" && !e.ended).reverse();
  const nextByPlan = new Map<string, Entry>();
  for (const e of entries) if (e.state === "planned" && !e.ended && !nextByPlan.has(e.o.planId)) nextByPlan.set(e.o.planId, e);
  const upcoming = [...nextByPlan.values()].sort((a, b) => at(a.o) - at(b.o));

  let hero: TodayHero | null = null;
  if (heroEntry) {
    const d = detail(heroEntry);
    hero = {
      key: d.key,
      dueWord: at(heroEntry.o) <= nowMs ? "Due" : "Later today",
      time: heroEntry.o.localTime,
      cycleName: d.cycleName,
      peptideName: d.peptideName,
      doseMg: d.doseMg,
      draw: drawOf(heroEntry),
      mixtureLabel: d.mixtureLabel,
      syringeLabel: d.syringeLabel,
      calculatorHref: d.calculatorHref,
    };
  }

  const rows: TodayRow[] = [];
  for (const e of today) {
    if (e === heroEntry) continue;
    detail(e);
    rows.push({
      key: e.o.key,
      kind: "today",
      title: nameOf(e),
      sub: `${e.o.localTime} · ${e.o.doseMg} mg · ${unitsLabel(drawOf(e))}`,
      status: e.o.actualAt ? `Taken ${wallOf(e.o.actualAt, e.o.timeZone).slice(11)}` : at(e.o) <= nowMs ? "Due" : "Later today",
      action: e.o.actualAt ? null : "Taken",
    });
  }
  for (const e of open) {
    detail(e);
    rows.push({
      key: e.o.key,
      kind: "open",
      title: `Unconfirmed · ${nameOf(e)}`,
      sub: `Planned ${occurrenceWhen(e.o)} · ${e.o.doseMg} mg · ${e.cycle.name}`,
      status: "",
      action: "Confirm",
    });
  }
  for (const e of upcoming) {
    const interval = effectOf(e.cycle, e.o, [], nowMs).kind === "interval";
    rows.push({
      key: e.o.key,
      kind: "next",
      title: nameOf(e),
      sub: `${occurrenceWhen(e.o)} · ${e.o.doseMg} mg · ${unitsLabel(drawOf(e))}${interval ? " · interval counted from the last actual dose" : ""}`,
      status: "Next",
      action: null,
    });
  }

  let nothingDue: TodayView["nothingDue"] = null;
  if (!heroEntry && current.length > 0) {
    const inBreak = current.some((cycle) => cycleStatus(cycle.revisions[cycle.revisions.length - 1], now.toString()) === "In break");
    const first = upcoming[0];
    nothingDue = {
      title: today.length ? "All done for today" : inBreak ? "Planned break" : "Nothing due today",
      body: first ? `Next: ${nameOf(first)}, ${occurrenceWhen(first.o)}` : "No upcoming doses in your plans.",
    };
  }

  let requested: TodayView["requested"] = null;
  if (input.requestedKey) {
    const e = entries.find((x) => x.o.key === input.requestedKey);
    if (!e) requested = { key: input.requestedKey, notice: STALE_LINK };
    else if (e.state === "planned") requested = { key: e.o.key, notice: `${nameOf(e)} is planned for ${occurrenceWhen(e.o)} — you can confirm it on its day.` };
    else {
      detail(e);
      requested = { key: e.o.key, notice: null };
    }
  }

  // The day and zone shown in the header: the hero's, else the newest cycle not ended, else any.
  const zone =
    heroEntry?.o.timeZone ??
    current.find((c) => cycleStatus(c.revisions[c.revisions.length - 1], now.toString()) !== "Ended")?.revisions.at(-1)?.timeZone ??
    current[0]?.revisions.at(-1)?.timeZone ??
    "UTC";

  return {
    dateLabel: longDate(wallOf(now.toString(), zone).slice(0, 10)),
    timeZone: zone,
    hasCycles: current.length > 0,
    hero,
    nothingDue,
    rows,
    badge: entries.filter((e) => !e.ended && isAwaitingConfirmation(e.o, now.toString())).length,
    doses,
    requested,
  };
}

/** The badge alone (app open, foreground): doses awaiting confirmation in cycles that have not ended. */
export function pendingDoses(cycles: readonly CycleRecord[], confirmations: ReadonlyMap<string, readonly Confirmation[]>, now: InstantInput): number {
  let count = 0;
  for (const cycle of cycles) {
    const revision = cycle.revisions.at(-1);
    if (!revision || cycleStatus(revision, now) === "Ended") continue;
    for (const occurrences of planOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? []).values()) {
      count += occurrences.filter((o) => isAwaitingConfirmation(o, now)).length;
    }
  }
  return count;
}
