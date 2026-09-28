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
//
// V1 (design v3): a skipped dose (dose_skips) is resolved: never the hero,
// never unconfirmed or in the badge; today's shows as "Skipped". The v3
// screen also reads `items` (every dose on the screen with its raw times and
// state, for the Now block, the day rail and the overdue rows), the header's
// short date and cycle day, and the injection-site rotation (./sites).
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleSpan, cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { occurrenceWhen, type RecordedConfirmation, recordedAmount, STATE_LABEL, type ViewPeptides } from "@/lib/cycles/views";
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
import { type InstantInput, localDateOf, toInstant } from "@/lib/schedule/zone";
import { shortDate } from "@/lib/alpha/format";
import { drawDisplay, type DrawDisplay, type DrawSetup, type ScheduleEffect, STALE_LINK, unitsLabel, type Wall, wallOf } from "./rules";
import { type SetupSegment, setupAt } from "./setups";
import { lastSiteNote, lastSiteUse, nextSite, type RotationSite } from "./sites";

/** A tracked open vial's estimate now (by mixture id): what R2's "Vial after" counts down from. */
export type VialNow = { label: string; strengthMg: string; remainingMg: string };

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
  /** The plan's saved-mixture setup now, and its version id (sent back for a confirmation "now"). */
  setup: DrawSetup | null;
  mixtureVersionId: string | null;
  /**
   * The plan's setups over time, each with its mixture's open tracked vial
   * now (null: none, or tracking off): the sheet shows (and sends) the one in
   * effect at the actual time chosen, and names the vial it would deduct from.
   */
  setups: DoseSetup[];
  /** `8 mg / 2 mL` and `1 mL`, when there is a saved mixture. */
  mixtureLabel: string;
  syringeLabel: string;
  /** The tracked open vial of the plan's mixture, when supply tracking is on. */
  vialLabel: string | null;
  /**
   * The next planned dose (today onward, not this one) of the plans using
   * this dose's mixture: "Vial after" is low when less than it would be left
   * (the low-stock rule), or null when none is planned.
   */
  vialNextMg: string | null;
  /** "every 2 days", "Mon and Thu" or "Daily" (the Now block's sub-line). */
  schedule: string;
  /** When skipped (V1): when the skip was entered, in the dose's zone. */
  skipped: { entered: string } | null;
  effect: ScheduleEffect;
  /**
   * When already confirmed: the actual and entered times in the dose's zone,
   * the amount taken (`0.3 mg`, with `(planned 0.4 mg)` when it differs),
   * and the site and notes recorded.
   */
  recorded: { actual: string; entered: string; amount: string; planned: string; site: string; notes: string } | null;
  calculatorHref: string;
};

/** A setup span with the vial a confirmation in it would deduct from (confirm_dose's rule), and its estimate now. */
export type DoseSetup = SetupSegment & { vialLabel: string | null; vial: VialNow | null };

/**
 * What the sheet shows and sends for an actual time (`at`: an instant, or
 * null for now): the setup whose units it shows, that setup's version id
 * (confirm_dose refuses another one, AP020), and the tracked vial it would
 * deduct from: the open vial of the mixture in effect at that time, or none
 * (no mixture then, or tracking off).
 */
export function setupForActual(
  detail: Pick<DoseDetail, "setup" | "mixtureVersionId" | "vialLabel" | "setups">,
  at: string | null,
): { setup: DrawSetup | null; versionId: string | null; vialLabel: string | null } {
  if (at === null) return { setup: detail.setup, versionId: detail.mixtureVersionId, vialLabel: detail.vialLabel };
  const segment = setupAt(detail.setups, at);
  return { setup: segment?.setup ?? null, versionId: segment?.versionId ?? null, vialLabel: segment?.vialLabel ?? null };
}

/** The tracked open vial (with its estimate now) a confirmation at `at` (null: now) would deduct from, as setupForActual picks it. */
export function vialForActual(detail: Pick<DoseDetail, "setup" | "mixtureVersionId" | "vialLabel" | "setups">, at: string | null): VialNow | null {
  if (at === null) {
    if (!detail.vialLabel) return null;
    return detail.setups.find((s) => s.versionId === detail.mixtureVersionId && s.vial)?.vial ?? null;
  }
  return setupAt(detail.setups, at)?.vial ?? null;
}

/** One dose on the v3 screen, with its raw times and state (see the header). Serializable. */
export type TodayDose = {
  key: string;
  /** today: dated today; open: an earlier day, unconfirmed (overdue); next: each plan's next dose on a later day. */
  kind: "today" | "open" | "next";
  state: OccurrenceState;
  planId: string;
  peptideName: string;
  cycleName: string;
  doseMg: string;
  scheduledAt: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  /** Recorded: when it was actually taken, the amount and site. */
  actualAt: string | null;
  amountMg: string | null;
  site: string;
  draw: DrawDisplay;
  setup: DrawSetup | null;
  /** R8's low-stock line (hero, today's doses still to take, each plan's next dose). */
  stockNote: string | null;
  schedule: string;
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
  /** "Vial A-02 is low · 0.2 mg left (estimate)" when its tracked vial is low, empty or over (R8). */
  stockNote: string | null;
};

export type TodayRow = {
  key: string;
  kind: "today" | "open" | "next";
  title: string;
  sub: string;
  /** `Due`, `Later today`, `Next`, or `Taken 20:05 · 0.3 mg` (the amount taken). */
  status: string;
  /** Quiet beside the status: `(planned 0.4 mg)` when the amount taken differs, else "". */
  statusNote: string;
  /** "Taken" confirms in one tap; "Confirm" opens the sheet; "Details" shows what was recorded. */
  action: "Taken" | "Confirm" | "Details" | null;
  /** As the hero's, for a dose still to take today or a plan's next dose. */
  stockNote: string | null;
};

export type TodayView = {
  /** `Saturday, September 26` and the zone it is in. */
  dateLabel: string;
  /** When this view was built (epoch ms): the screen's clock until it ticks. */
  renderedAt: number;
  /** `Sat, Sep 26` (v3 header) and that local date. */
  shortDate: string;
  today: string;
  /** "Day 24 of 84" of the cycle the header follows (the hero's, else the newest running one), or null. */
  cycleDay: string | null;
  /** Every dose on the screen: today's in time order, then unconfirmed ones newest first, then each plan's next. */
  items: TodayDose[];
  /** The Now block's dose: the hero, else the first plan's next dose on a later day. */
  now: { key: string; mode: "due" | "later" | "next" } | null;
  /** R2's rotation: the site to preselect, and the last-used one. */
  sites: { suggested: RotationSite; last: { site: string; note: string } | null };
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
  /** Recorded doses as confirmations (with what was recorded), by cycle id. */
  confirmations: ReadonlyMap<string, readonly RecordedConfirmation[]>;
  peptides: ViewPeptides;
  /** The saved mixture each plan uses now, by plan id. */
  mixtures: ReadonlyMap<string, Mixture>;
  /** Each plan's setups over time, by plan id (doses/service planSetups). */
  setups: ReadonlyMap<string, SetupSegment[]>;
  /** Open tracked vial labels by mixture id (empty while tracking is off). */
  vials: ReadonlyMap<string, string>;
  /** R8 low-stock notes by plan id (src/lib/supplies/view todayStockNotes); none while tracking is off. */
  stock?: ReadonlyMap<string, string>;
  /** Tracked open vials' estimates by mixture id (empty while tracking is off), for R2's "Vial after". */
  vialEstimates?: ReadonlyMap<string, VialNow>;
  now: InstantInput;
  /** The requested occurrence key (`?dose=`), if any. */
  requestedKey?: string | null;
};

type Entry = { o: Occurrence; state: OccurrenceState; cycle: CycleRecord; ended: boolean; peptideId: string };

/** The app's zone (strictly local; Marco, 2026-09-26): the header's day without cycles. */
export const LOCAL_TIME_ZONE = "America/Toronto";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Mon … Sun, the builder's order. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const at = (o: Occurrence) => Date.parse(o.scheduledAt);

/** "Daily", "every 2 days", "Mon and Thu", "Mon, Wed and Fri". */
function scheduleWords(phase: Phase | null): string {
  if (!phase || phase.kind !== "active") return "";
  if (phase.schedule.type === "interval") return phase.schedule.everyDays === 1 ? "Daily" : `every ${phase.schedule.everyDays} days`;
  const days = WEEK_ORDER.filter((d) => (phase.schedule as { days: number[] }).days.includes(d)).map((d) => WEEKDAYS[d]);
  if (days.length === 7) return "Daily";
  return days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : (days[0] ?? "");
}
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

  const stockOf = (entry: Entry) => input.stock?.get(entry.o.planId) ?? null;

  const recordedByKey = new Map([...input.confirmations.values()].flat().map((c) => [c.key, c]));
  /** What was recorded for a taken dose (the engine's actualAt is the recorded one). */
  const recordOf = (o: Occurrence) => (o.actualAt ? recordedByKey.get(o.key) : undefined);
  const todayOf = (o: Occurrence) => wallOf(now.toString(), o.timeZone).slice(0, 10);

  /** The next planned dose of the plans on `mixtureId` from today on, other than `key` (see DoseDetail.vialNextMg). */
  const nextOnMixture = (mixtureId: string, key: string): string | null => {
    const planIds = new Set([...input.mixtures.values()].filter((m) => m.id === mixtureId).flatMap((m) => m.planIds));
    const next = entries.find(
      (e) => planIds.has(e.o.planId) && e.o.key !== key && !e.ended && (e.state === "due" || e.state === "planned") && e.o.localDate >= todayOf(e.o),
    );
    return next?.o.doseMg ?? null;
  };

  const doses: Record<string, DoseDetail> = {};
  const detail = (entry: Entry): DoseDetail => {
    const { o } = entry;
    const mixture = mixtureOf(entry);
    const record = recordOf(o);
    const amount = recordedAmount(o.doseMg, record?.amountMg);
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
      mixtureVersionId: mixture?.setupId ?? null,
      setups: (input.setups.get(o.planId) ?? []).map((s) => {
        const label = input.vials.get(s.mixtureId) ?? null;
        const estimate = label ? input.vialEstimates?.get(s.mixtureId) : undefined;
        return { ...s, vialLabel: label, vial: estimate && label ? { ...estimate, label } : null };
      }),
      mixtureLabel: mixture ? `${mixture.setup.vialMg} mg / ${mixture.setup.liquidMl} mL` : "",
      syringeLabel: mixture ? SYRINGE_LABEL[mixture.setup.syringe] : "",
      vialLabel: mixture ? (input.vials.get(mixture.id) ?? null) : null,
      vialNextMg: mixture ? nextOnMixture(mixture.id, o.key) : null,
      schedule: scheduleWords(phaseOf(entry.cycle, o.planId, o.phaseId)),
      skipped: o.skipped && recordedByKey.get(o.key) ? { entered: formatDateTime(recordedByKey.get(o.key)!.recordedAt, { timeZone: o.timeZone }) } : null,
      effect: effectOf(entry.cycle, o, byPlan.get(o.planId)?.occurrences ?? [], nowMs),
      recorded:
        o.actualAt && record
          ? {
              actual: formatDateTime(o.actualAt, { timeZone: o.timeZone }),
              entered: formatDateTime(record.recordedAt, { timeZone: o.timeZone }),
              amount: amount.mg,
              planned: amount.planned,
              site: record.site ?? "",
              notes: record.notes ?? "",
            }
          : null,
      calculatorHref: `/app/calculator?plan=${o.planId}`,
    };
    doses[o.key] = value;
    return value;
  };

  const today = entries.filter(
    (e) => e.state === "due" || ((e.o.actualAt || e.o.skipped) && e.o.localDate === wallOf(now.toString(), e.o.timeZone).slice(0, 10)),
  );
  const heroEntry = today.find((e) => e.state === "due") ?? null;
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
      stockNote: stockOf(heroEntry),
    };
  }

  const rows: TodayRow[] = [];
  for (const e of today) {
    if (e === heroEntry) continue;
    const d = detail(e);
    if (e.o.skipped) {
      rows.push({
        key: e.o.key,
        kind: "today",
        title: nameOf(e),
        sub: `Planned ${e.o.localTime} · ${e.o.doseMg} mg`,
        status: "Skipped",
        statusNote: "",
        action: "Details",
        stockNote: null,
      });
      continue;
    }
    if (e.o.actualAt) {
      // What was recorded, not the plan: the amount taken, the plan only where it differs.
      const amount = recordedAmount(e.o.doseMg, recordOf(e.o)?.amountMg);
      rows.push({
        key: e.o.key,
        kind: "today",
        title: nameOf(e),
        sub: [`Planned ${e.o.localTime}`, d.recorded?.site].filter(Boolean).join(" · "),
        status: `Taken ${wallOf(e.o.actualAt, e.o.timeZone).slice(11)} · ${amount.mg}`,
        statusNote: amount.planned,
        action: "Details",
        stockNote: null,
      });
      continue;
    }
    rows.push({
      key: e.o.key,
      kind: "today",
      title: nameOf(e),
      sub: `${e.o.localTime} · ${e.o.doseMg} mg · ${unitsLabel(drawOf(e))}`,
      status: at(e.o) <= nowMs ? "Due" : "Later today",
      statusNote: "",
      action: "Taken",
      stockNote: stockOf(e),
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
      statusNote: "",
      action: "Confirm",
      stockNote: null,
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
      statusNote: "",
      action: null,
      stockNote: stockOf(e),
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

  // The day and zone shown in the header: the hero's, else the newest cycle
  // not ended, else any, else the app's own zone (it is strictly local;
  // supplement routines and check-ins follow it too).
  const zone =
    heroEntry?.o.timeZone ??
    current.find((c) => cycleStatus(c.revisions[c.revisions.length - 1], now.toString()) !== "Ended")?.revisions.at(-1)?.timeZone ??
    current[0]?.revisions.at(-1)?.timeZone ??
    LOCAL_TIME_ZONE;

  // The v3 screen's structured doses (see TodayDose).
  const item = (e: Entry, kind: TodayDose["kind"], stock: boolean): TodayDose => {
    const d = doses[e.o.key] ?? detail(e);
    const record = recordOf(e.o);
    return {
      key: e.o.key,
      kind,
      state: e.state,
      planId: e.o.planId,
      peptideName: nameOf(e),
      cycleName: e.cycle.name,
      doseMg: e.o.doseMg,
      scheduledAt: e.o.scheduledAt,
      localDate: e.o.localDate,
      localTime: e.o.localTime,
      timeZone: e.o.timeZone,
      actualAt: e.o.actualAt,
      amountMg: record?.amountMg ?? null,
      site: record?.site ?? "",
      draw: drawOf(e),
      setup: setupOf(e),
      stockNote: stock ? stockOf(e) : null,
      schedule: d.schedule,
    };
  };
  const items: TodayDose[] = [
    ...today.map((e) => item(e, "today", e.state === "due")),
    ...open.map((e) => item(e, "open", false)),
    ...upcoming.map((e) => item(e, "next", true)),
  ];
  const nowEntry = heroEntry ?? upcoming[0] ?? null;

  // The header's cycle: the hero's, else the newest one running today.
  const running = current.filter((c) => {
    const status = cycleStatus(c.revisions[c.revisions.length - 1], now.toString());
    return status === "Active" || status === "In break";
  });
  const headerCycle = (heroEntry && running.includes(heroEntry.cycle) ? heroEntry.cycle : null) ?? running.at(-1) ?? null;
  let cycleDay: string | null = null;
  if (headerCycle) {
    const revision = headerCycle.revisions[headerCycle.revisions.length - 1];
    const span = cycleSpan(revision);
    const localToday = localDateOf(now, revision.timeZone);
    const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
    cycleDay = `Day ${days(span.start, localToday) + 1} of ${days(span.start, span.end) + 1}`;
  }

  // Site rotation: the latest dose recorded at a rotation site, by actual time.
  const uses = [...input.confirmations.values()].flat().filter((c) => !c.skipped && c.site) as (RecordedConfirmation & { site: string })[];
  const last = lastSiteUse(uses.map((c) => ({ site: c.site, actualAt: String(c.actualAt), recordedAt: String(c.recordedAt) })));
  const headerToday = wallOf(now.toString(), zone).slice(0, 10);

  return {
    dateLabel: longDate(wallOf(now.toString(), zone).slice(0, 10)),
    renderedAt: nowMs,
    shortDate: shortDate(headerToday),
    today: headerToday,
    cycleDay,
    items,
    now: nowEntry ? { key: nowEntry.o.key, mode: nowEntry === heroEntry ? (at(nowEntry.o) <= nowMs ? "due" : "later") : "next" } : null,
    sites: {
      suggested: nextSite(last?.site),
      last: last ? { site: last.site, note: lastSiteNote(last.site, wallOf(last.actualAt, zone).slice(0, 10), headerToday) } : null,
    },
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
