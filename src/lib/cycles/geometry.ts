// V2 cycle geometry (design v3 R10, R3, R4c, D2): the day ruler, the phase
// lanes and their date axis, as percentages of the available width so the
// same numbers draw a 350 px phone card and a 1000 px laptop timeline. Pure
// and client-safe; unit-tested (tests/unit/cycle-geometry.test.ts).
import { Exact, normalizeDecimal } from "@/lib/calculator/decimal";
import type { ActivePhase, Phase } from "@/lib/schedule/engine";
import type { LocalDate } from "@/lib/schedule/zone";
import { doseAt } from "./rules";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days from `from` to `to` (local dates). */
export const daysBetween = (from: LocalDate, to: LocalDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const plusDays = (date: LocalDate, days: number): LocalDate =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Sep 1". */
export const monthDay = (date: LocalDate) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

/** "Days 1–56", or "Day 3" for one day. */
export const daysLabel = (from: number, to: number) => (from === to ? `Day ${from}` : `Days ${from}–${to}`);

/**
 * "Sep 1 – Oct 26", "Nov 10 – 23" within a month, and the years when the
 * range crosses one or is not in `year` ("Oct 6 – Dec 1, 2025").
 */
export function dateRange(from: LocalDate, to: LocalDate, year?: string): string {
  const [fy, ty] = [from.slice(0, 4), to.slice(0, 4)];
  if (fy !== ty) return `${monthDay(from)}, ${fy} – ${monthDay(to)}, ${ty}`;
  const tail = year && ty !== year ? `, ${ty}` : "";
  if (from.slice(0, 7) === to.slice(0, 7) && from !== to) return `${monthDay(from)} – ${Number(to.slice(8, 10))}${tail}`;
  return from === to ? `${monthDay(from)}${tail}` : `${monthDay(from)} – ${monthDay(to)}${tail}`;
}

// ── The day ruler (R10 card, R3 and D2 Now block) ───────────────────────────

export type Ticks = {
  /** One tick per day: the distance between ticks, % of the width. */
  pitch: number;
  /** Days before today, drawn filled: % of the width (100 once ended). */
  filled: number;
  /** The centre of today's day, %, or null before the start and after the end. */
  today: number | null;
};

/**
 * `total` days; `day` is today's 1-based day in the cycle (0 or less before
 * it starts, more than `total` once it has ended).
 */
export function tickGeometry(total: number, day: number): Ticks {
  const days = Math.max(1, Math.floor(total));
  const past = Math.min(days, Math.max(0, day - 1));
  return {
    pitch: 100 / days,
    filled: (past / days) * 100,
    today: day >= 1 && day <= days ? ((day - 0.5) / days) * 100 : null,
  };
}

// ── Date axis ───────────────────────────────────────────────────────────────

export type AxisLabel = {
  text: string;
  /** Where it points, % of the width. */
  percent: number;
  /** start: left edge at `percent`; end: right edge at 100%; center: centred on it. */
  align: "start" | "center" | "end";
  today?: boolean;
};

/**
 * Labels under a ruler or over the lanes: the first date, the last date,
 * "Today" (on its day) and each month's 1st in between, e.g. "Sep 1 · Today
 * · Nov 1 · Nov 23". Labels closer than `minGap` % to a label that ranks
 * higher are dropped (Today, then the ends, then months), so they never
 * overlap.
 */
export function axisLabels(start: LocalDate, end: LocalDate, today: LocalDate | null, options: { months?: boolean; minGap?: number } = {}): AxisLabel[] {
  const total = daysBetween(start, end) + 1;
  const minGap = options.minGap ?? 16;
  const at = (date: LocalDate) => (daysBetween(start, date) / total) * 100;
  const kept: AxisLabel[] = [];
  const clear = (percent: number) => kept.every((label) => Math.abs(label.percent - percent) >= minGap);
  const index = today ? daysBetween(start, today) : -1;
  if (today && index >= 0 && index < total) kept.push({ text: "Today", percent: ((index + 0.5) / total) * 100, align: "center", today: true });
  if (clear(0)) kept.push({ text: monthDay(start), percent: 0, align: "start" });
  if (total > 1 && clear(100)) kept.push({ text: monthDay(end), percent: 100, align: "end" });
  if (options.months !== false) {
    for (let date = firstOfNextMonth(start); date < end; date = firstOfNextMonth(date)) {
      const percent = at(date);
      if (clear(percent)) kept.push({ text: monthDay(date), percent, align: "center" });
    }
  }
  return kept.sort((a, b) => a.percent - b.percent);
}

function firstOfNextMonth(date: LocalDate): LocalDate {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// ── Lanes (R3 peptide cards, R4c preview, D2 timeline) ──────────────────────

export type LaneBar = {
  kind: "active" | "break";
  /** 1-based days of the cycle, inclusive. */
  from: number;
  to: number;
  /** % of the width. */
  left: number;
  width: number;
  /** The dose in force, mg ("." decimal point); null for a break. */
  doseMg: string | null;
  /** 0–1: where the dose sits between the lane's smallest and largest; null when every dose is the same (or a break). */
  level: number | null;
  firstDate: LocalDate;
  lastDate: LocalDate;
  /** The phase it draws (its segments share it). */
  phaseId: string;
};

/**
 * An active phase cut where its dose changes: each piece's dates and dose
 * (doseAt). A time change alone doesn't cut it: the lane draws amounts.
 */
export function doseSegments(phase: ActivePhase): { start: LocalDate; end: LocalDate; dose: string }[] {
  const cuts = [...new Set((phase.doseChanges ?? []).map((change) => change.from))].filter((from) => from > phase.start && from <= phase.end).sort();
  const starts = [phase.start, ...cuts];
  const pieces = starts.map((start, i) => ({
    start,
    end: i + 1 < starts.length ? plusDays(starts[i + 1], -1) : phase.end,
    dose: doseAt(phase, start),
  }));
  // A change to the same amount draws as one piece.
  return pieces.reduce<typeof pieces>((merged, piece) => {
    const last = merged[merged.length - 1];
    if (last && sameAmount(last.dose, piece.dose)) last.end = piece.end;
    else merged.push({ ...piece });
    return merged;
  }, []);
}

const sameAmount = (a: string, b: string) => {
  const [x, y] = [normalizeDecimal(a), normalizeDecimal(b)];
  return x !== null && y !== null && new Exact(x).equals(new Exact(y));
};

/**
 * One peptide's lane over a cycle of `total` days from `start`: a bar per
 * break and per dose piece of each active phase, clamped to the cycle. A
 * bar's `level` places its dose between the lane's smallest and largest.
 */
export function laneBars(phases: readonly Phase[], start: LocalDate, total: number): LaneBar[] {
  const days = Math.max(1, total);
  const clamp = (date: LocalDate) => Math.min(days, Math.max(1, daysBetween(start, date) + 1));
  const bars: LaneBar[] = [];
  for (const phase of [...phases].sort((a, b) => a.start.localeCompare(b.start))) {
    const pieces = phase.kind === "break" ? [{ start: phase.start, end: phase.end, dose: null }] : doseSegments(phase);
    for (const piece of pieces) {
      const [from, to] = [clamp(piece.start), clamp(piece.end)];
      bars.push({
        kind: phase.kind,
        from,
        to,
        left: ((from - 1) / days) * 100,
        width: ((to - from + 1) / days) * 100,
        doseMg: piece.dose,
        level: null,
        firstDate: piece.start,
        lastDate: piece.end,
        phaseId: phase.id,
      });
    }
  }
  const doses = bars.filter((bar) => bar.doseMg !== null).map((bar) => new Exact(normalizeDecimal(bar.doseMg) ?? "0"));
  if (doses.length) {
    const min = doses.reduce((a, b) => (b.lessThan(a) ? b : a));
    const max = doses.reduce((a, b) => (b.greaterThan(a) ? b : a));
    if (!min.equals(max)) {
      for (const bar of bars) {
        if (bar.doseMg === null) continue;
        bar.level = new Exact(normalizeDecimal(bar.doseMg) ?? "0").minus(min).dividedBy(max.minus(min)).toNumber();
      }
    }
  }
  return bars;
}

/** Bar heights (px): phone lanes 8–16 (10 when every dose is equal), the laptop timeline 24–34. */
export const LANE_HEIGHTS = {
  card: { min: 8, max: 16, equal: 10 },
  timeline: { min: 24, max: 34, equal: 34 },
} as const;

export function barHeight(bar: Pick<LaneBar, "kind" | "level">, size: { min: number; max: number; equal: number }): number {
  if (bar.kind === "break" || bar.level === null) return size.equal;
  return Math.round(size.min + bar.level * (size.max - size.min));
}
