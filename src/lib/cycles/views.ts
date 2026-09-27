// R2 Cycles and R4 Cycle detail: what the screens show, derived from a
// cycle's revisions and the S7 engine (handoff docs/design/research-app
// README.md "R2 Cycles / R4 Cycle detail"; the prototype's cycleRow and cyc
// view). Pure and shared by the screens and the tests.
//
// Doses always come from the engine across every revision
// (planOccurrences/cycleOccurrences in schedule.ts), never from one revision
// alone, so a mid-cycle edit shows earlier doses as they were and later ones
// as edited. Times are each occurrence's own local date and time (in the
// zone of the revision that scheduled it). Confirmations (S12) attach by key:
// until they exist, callers pass none.
import { Exact } from "@/lib/calculator/decimal";
import { formatDate, formatDateTime, formatDay, formatMonthDay } from "@/lib/format";
import {
  type ActivePhase,
  type Confirmation,
  type Occurrence,
  type OccurrenceState,
  occurrenceState,
  type Phase,
  timeOn,
} from "@/lib/schedule/engine";
import { formatLocalTime, type InstantInput, type LocalDate, localDateOf, toInstant, wallClock } from "@/lib/schedule/zone";
import { doseAt, type CycleRecord, type CycleRevision, type StoredPlan } from "./rules";
import { type CycleStatus, cycleOccurrences, cycleSpan, cycleStatus, planOccurrences } from "./schedule";
import type { CycleSummary } from "./service";

/**
 * A recorded dose (S12) as the engine's confirmation, plus what was recorded:
 * the amount actually taken (shown instead of the planned dose), the site and
 * the notes. The engine reads only the Confirmation fields.
 */
export type RecordedConfirmation = Confirmation & { amountMg?: string; site?: string; notes?: string };

/** What a recorded dose shows: `0.3 mg`, and `(planned 0.4 mg)` only when it differs. */
export function recordedAmount(plannedMg: string, amountMg: string | undefined): { mg: string; planned: string } {
  if (!amountMg) return { mg: `${plannedMg} mg`, planned: "" };
  const same = new Exact(amountMg).equals(new Exact(plannedMg));
  return { mg: `${amountMg} mg`, planned: same ? "" : `(planned ${plannedMg} mg)` };
}

/** `Thigh L · Felt fine`: the recorded site and notes, or "". */
export const recordedDetails = (c: Pick<RecordedConfirmation, "site" | "notes"> | undefined) =>
  [c?.site, c?.notes].filter((part): part is string => Boolean(part)).join(" · ");

/** Library peptides by id, as the caller may read them (own cycles keep withdrawn ones). */
export type ViewPeptides = ReadonlyMap<string, { name: string; available: boolean; cyclingOff?: string }>;

const nameOf = (peptides: ViewPeptides, id: string | undefined) => (id && peptides.get(id)?.name) || "Unknown peptide";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Mon … Sun, the builder's order. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const current = (cycle: Pick<CycleRecord, "revisions">): CycleRevision => cycle.revisions[cycle.revisions.length - 1];
const dayIndex = (from: LocalDate, to: LocalDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const addDay = (date: LocalDate, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Each plan id's peptide, across every revision (a plan never changes peptide). */
export function planPeptides(cycle: Pick<CycleRecord, "revisions">): Map<string, string> {
  const map = new Map<string, string>();
  for (const revision of cycle.revisions) for (const plan of revision.plans) map.set(plan.planId, plan.peptideId);
  return map;
}

/** "HH:MM" of an instant in a zone. */
const timeIn = (at: InstantInput, timeZone: string) => formatLocalTime(wallClock(toInstant(at), timeZone));

/** `Fri Sep 11 · 20:00`, in the occurrence's own zone. */
export const occurrenceWhen = (o: Pick<Occurrence, "localDate" | "localTime">) => `${formatDay(o.localDate)} · ${o.localTime}`;

/** The handoff's dose state labels. */
export const STATE_LABEL: Record<OccurrenceState, string> = { taken: "Taken", due: "Due", open: "Unconfirmed", planned: "Planned" };

/** `every 5 days · 08:00` or `Mon · Wed · Fri · 07:30`, with the time in effect on `date`. */
export function scheduleLabel(phase: ActivePhase, date: LocalDate): string {
  const time = timeOn(phase, date);
  if (phase.schedule.type === "interval") {
    const n = phase.schedule.everyDays;
    return `every ${n} day${n === 1 ? "" : "s"} · ${time}`;
  }
  const days = phase.schedule.days;
  return `${WEEK_ORDER.filter((d) => days.includes(d as never)).map((d) => WEEKDAYS[d]).join(" · ")} · ${time}`;
}

// ── R2 Cycles ───────────────────────────────────────────────────────────────

export type CycleRow = {
  id: string;
  name: string;
  status: CycleStatus;
  /** `Sep 11 – Oct 9, 2026` */
  dates: string;
  /** `Compound A + Compound B` */
  peptides: string;
  nextLine: string;
  /** Past doses never confirmed (the handoff's "open"). */
  unconfirmed: number;
};

/**
 * One R2 card. `occurrences` are the cycle's (cycleOccurrences); the next line is
 * the next unconfirmed dose, else for an ended cycle how many were recorded,
 * else the last recorded dose, else "No doses recorded yet".
 */
export function cycleRow(
  cycle: Pick<CycleRecord, "revisions">,
  summary: CycleSummary,
  occurrences: readonly Occurrence[],
  peptides: ViewPeptides,
  now: InstantInput,
): CycleRow {
  const at = toInstant(now).epochMilliseconds;
  const byPlan = planPeptides(cycle);
  const next = occurrences.find((o) => !o.actualAt && Date.parse(o.scheduledAt) >= at);
  const taken = occurrences.filter((o) => o.actualAt);
  const last = taken.reduce<Occurrence | null>((a, o) => (!a || Date.parse(o.actualAt!) > Date.parse(a.actualAt!) ? o : a), null);
  let nextLine = "No doses recorded yet";
  if (next) nextLine = `Next: ${nameOf(peptides, byPlan.get(next.planId))} · ${occurrenceWhen(next)}`;
  else if (summary.status === "Ended") nextLine = `Ended · ${taken.length} of ${occurrences.length} doses recorded`;
  else if (last) nextLine = `Last recorded ${formatDateTime(last.actualAt!, { timeZone: last.timeZone })}`;
  return {
    id: summary.id,
    name: summary.name,
    status: summary.status,
    dates: `${formatMonthDay(summary.start)} – ${formatDate(summary.end)}`,
    peptides: summary.peptideIds.map((id) => nameOf(peptides, id)).join(" + "),
    nextLine,
    unconfirmed: occurrences.filter((o) => occurrenceState(o, now) === "open").length,
  };
}

/** R2's groups, in order; the screen shows only those with rows. */
export function groupCycles(rows: readonly CycleRow[]): { title: string; rows: CycleRow[] }[] {
  return [
    { title: "Current", rows: rows.filter((row) => row.status === "Active" || row.status === "In break") },
    { title: "Upcoming", rows: rows.filter((row) => row.status === "Upcoming") },
    { title: "Past", rows: rows.filter((row) => row.status === "Ended") },
  ];
}

// ── R4 Cycle detail ─────────────────────────────────────────────────────────

/** Day columns are 1-based and inclusive: a bar from `from` to `to`. */
export type TimelineBar = { from: number; to: number; kind: "active" | "break"; raised: boolean; title: string; caption: string };
export type TimelineDot = { day: number; key: string; state: OccurrenceState; label: string };
export type TimelineLane = { planId: string; name: string; sub: string; bars: TimelineBar[]; dots: TimelineDot[] };
export type Timeline = {
  /** Days from the cycle's first to last date, inclusive. */
  total: number;
  months: { label: string; from: number; to: number }[];
  lanes: TimelineLane[];
  /** Today's position as a percentage of the width, or null outside the cycle. */
  todayPercent: number | null;
};

export type PhaseRow = { word: "Now" | "Done" | "Next" | "Break"; current: boolean; text: string; sub: string };
export type PlanCard = { planId: string; name: string; availability: string; phases: PhaseRow[]; guidance: string };
export type HistoryRow = {
  key: string;
  planned: string;
  peptide: string;
  /** The amount taken once recorded, else the planned dose. */
  mg: string;
  /** `(planned 0.4 mg)` when the amount taken differs from the plan, else "". */
  plannedMg: string;
  /** The recorded site and notes, or "". */
  details: string;
  actual: string;
  entered: string;
  state: OccurrenceState;
  stateLabel: string;
};

export type CycleDetail = {
  status: CycleStatus;
  /** `Active · day 5 of 36`, `Upcoming · starts Sep 30`, `Ended · 36 days` */
  statusLine: string;
  /** `Sep 11, 2026 – Oct 16, 2026 · America/Toronto · Goal: … · Baseline: …` */
  meta: string;
  timeZone: string;
  timeline: Timeline;
  plans: PlanCard[];
  /** Newest first: every dose up to today, and any confirmed one. */
  history: HistoryRow[];
};

/** The shown dose, "." as the decimal point. */
const mg = (dose: string) => `${dose} mg`;

/**
 * An active phase cut at its dose and time changes: each piece's first and
 * last date, and the dose and time in force there (doseAt, timeOn).
 */
export function phaseSegments(phase: ActivePhase): { start: LocalDate; end: LocalDate; dose: string; time: string }[] {
  const cuts = [...new Set([...(phase.doseChanges ?? []), ...(phase.timeChanges ?? [])].map((change) => change.from))]
    .filter((from) => from > phase.start && from <= phase.end)
    .sort();
  const starts = [phase.start, ...cuts];
  return starts.map((start, i) => ({
    start,
    end: i + 1 < starts.length ? addDay(starts[i + 1], -1) : phase.end,
    dose: doseAt(phase, start),
    time: timeOn(phase, start),
  }));
}

const isAbove = (dose: string, base: string | null) => base !== null && new Exact(dose).greaterThan(new Exact(base));

function lane(
  plan: StoredPlan,
  start: LocalDate,
  total: number,
  occurrences: readonly Occurrence[],
  peptides: ViewPeptides,
  now: InstantInput,
  recorded: ReadonlyMap<string, RecordedConfirmation> = new Map(),
): TimelineLane {
  const name = nameOf(peptides, plan.peptideId);
  const firstActive = plan.phases.find((phase): phase is ActivePhase => phase.kind === "active") ?? null;
  const base = firstActive ? doseAt(firstActive, firstActive.start) : null;
  const clamp = (date: LocalDate) => Math.min(total, Math.max(1, dayIndex(start, date) + 1));
  const bars: TimelineBar[] = plan.phases.flatMap((phase): TimelineBar[] => {
    if (phase.kind === "break") {
      return [
        {
          from: clamp(phase.start),
          to: clamp(phase.end),
          kind: "break",
          raised: false,
          title: `Break ${formatMonthDay(phase.start)} – ${formatMonthDay(phase.end)}`,
          caption: "Break",
        },
      ];
    }
    return phaseSegments(phase).map((segment, i, segments) => {
      const raised = isAbove(segment.dose, base);
      // A piece cut only by a time change repeats its dose: no second caption.
      const sameDose = i > 0 && segments[i - 1].dose === segment.dose;
      return {
        from: clamp(segment.start),
        to: clamp(segment.end),
        kind: "active",
        raised,
        title: `${mg(segment.dose)} · ${scheduleLabel(phase, segment.start)}`,
        caption: sameDose ? "" : raised ? `${mg(segment.dose)} · planned increase` : mg(segment.dose),
      };
    });
  });
  const dots = occurrences.map((o): TimelineDot => {
    const state = occurrenceState(o, now);
    const status = o.actualAt
      ? `Taken ${timeIn(o.actualAt, o.timeZone)} · ${recordedAmount(o.doseMg, recorded.get(o.key)?.amountMg).mg}`
      : STATE_LABEL[state];
    return { day: clamp(o.localDate), key: o.key, state, label: `${name} · ${occurrenceWhen(o)} · ${status}` };
  });
  return { planId: plan.planId, name, sub: firstActive ? scheduleLabel(firstActive, firstActive.start) : "", bars, dots };
}

/** Month labels over the day columns: at the first day and at each 1st of a month. */
function months(start: LocalDate, total: number): Timeline["months"] {
  const labels: { label: string; from: number }[] = [];
  for (let i = 0; i < total; i++) {
    const date = addDay(start, i);
    if (i === 0 || date.endsWith("-01")) labels.push({ label: MONTHS[Number(date.slice(5, 7)) - 1], from: i + 1 });
  }
  return labels.map((m, i) => ({ ...m, to: i + 1 < labels.length ? labels[i + 1].from - 1 : total }));
}

/** Changes dated after `after`, e.g. ` · from Sep 27: 0.5 mg, 07:15`. */
function laterChanges(phase: ActivePhase, after: LocalDate): string {
  const dates = [...new Set([...(phase.doseChanges ?? []), ...(phase.timeChanges ?? [])].map((c) => c.from))]
    .filter((from) => from > after)
    .sort();
  return dates
    .map((from) => {
      const parts = [
        (phase.doseChanges ?? []).some((c) => c.from === from) ? mg(doseAt(phase, from)) : null,
        (phase.timeChanges ?? []).some((c) => c.from === from) ? timeOn(phase, from) : null,
      ].filter(Boolean);
      return ` · from ${formatMonthDay(from)}: ${parts.join(", ")}`;
    })
    .join("");
}

/** One phase in a plan card: Now / Done / Next / Break, with what applies (today's values while under way). */
export function phaseRow(phase: Phase, today: LocalDate): PhaseRow {
  const isCurrent = phase.start <= today && phase.end >= today;
  const dates = `${formatMonthDay(phase.start)} – ${formatDate(phase.end)}`;
  if (phase.kind === "break") {
    return { word: "Break", current: isCurrent, text: `No doses ${formatMonthDay(phase.start)} – ${formatMonthDay(phase.end)}`, sub: dates };
  }
  const on = isCurrent ? today : phase.end < today ? phase.end : phase.start;
  // S11: the saved mixture's syringe units go after the dose here.
  return {
    word: isCurrent ? "Now" : phase.end < today ? "Done" : "Next",
    current: isCurrent,
    text: `${mg(doseAt(phase, on))} · ${scheduleLabel(phase, on)}`,
    sub: dates + laterChanges(phase, on),
  };
}

/** Everything R4 shows for one cycle as of `now`. */
export function cycleDetail(
  cycle: CycleRecord,
  peptides: ViewPeptides,
  now: InstantInput,
  confirmations: readonly RecordedConfirmation[] = [],
): CycleDetail {
  const recorded = new Map(confirmations.map((c) => [c.key, c]));
  const revision = current(cycle);
  const { start, end } = cycleSpan(revision);
  const status = cycleStatus(revision, now);
  const total = dayIndex(start, end) + 1;
  const today = localDateOf(toInstant(now), revision.timeZone);
  const index = dayIndex(start, today);
  const byPlan = planOccurrences(cycle.revisions, confirmations);
  const planOf = planPeptides(cycle);

  const statusLine =
    status === "Upcoming" ? `starts ${formatMonthDay(start)}` : status === "Ended" ? `${total} days` : `day ${index + 1} of ${total}`;

  const lanes = revision.plans.map((plan) =>
    lane(
      plan,
      start,
      total,
      [...(byPlan.get(plan.planId) ?? [])].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)),
      peptides,
      now,
      recorded,
    ),
  );

  const plans = revision.plans.map((plan): PlanCard => {
    const peptide = peptides.get(plan.peptideId);
    return {
      planId: plan.planId,
      name: nameOf(peptides, plan.peptideId),
      availability: peptide && !peptide.available ? "No longer offered for new cycles · history kept" : "",
      phases: plan.phases.map((phase) => phaseRow(phase, today)),
      guidance: peptide?.cyclingOff ?? "",
    };
  });

  const history = cycleOccurrences(cycle.revisions, confirmations)
    .map((o) => ({ o, state: occurrenceState(o, now) }))
    .filter(({ state }) => state !== "planned")
    .reverse()
    .map(({ o, state }): HistoryRow => {
      const record = o.actualAt ? recorded.get(o.key) : undefined;
      const amount = recordedAmount(o.doseMg, record?.amountMg);
      return {
        key: o.key,
        planned: occurrenceWhen(o),
        peptide: nameOf(peptides, planOf.get(o.planId)),
        mg: amount.mg,
        plannedMg: amount.planned,
        details: recordedDetails(record),
        actual: o.actualAt ? formatDateTime(o.actualAt, { timeZone: o.timeZone }) : "—",
        entered: record ? formatDateTime(record.recordedAt, { timeZone: o.timeZone }) : "—",
        state,
        stateLabel: STATE_LABEL[state],
      };
    });

  return {
    status,
    statusLine: `${status} · ${statusLine}`,
    meta: [
      `${formatDate(start)} – ${formatDate(end)}`,
      revision.timeZone,
      `Goal: ${cycle.goal || "—"}`,
      `Baseline: ${cycle.baseline || "not set"}`,
    ].join(" · "),
    timeZone: revision.timeZone,
    timeline: {
      total,
      months: months(start, total),
      lanes,
      todayPercent: index >= 0 && index < total ? Number((((index + 0.5) / total) * 100).toFixed(2)) : null,
    },
    plans,
    history,
  };
}

