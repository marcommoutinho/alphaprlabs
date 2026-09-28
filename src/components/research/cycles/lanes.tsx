import { type AxisLabel, barHeight, type LaneBar, LANE_HEIGHTS, tickGeometry } from "@/lib/cycles/geometry";
import { cn } from "@/lib/utils";

// Cycle gauges (design v3 §7.8, R10 / R3 / R4c / D2): the day ruler, a
// peptide's phase lane and the laptop timeline. Geometry is
// src/lib/cycles/geometry.ts; here it is only drawn. Every picture has its
// words beside it (the day, the phase rows), so the drawings are images with
// a short label or decorative.

/** Hatching for a break: diagonal `ink-3` lines on the lane. */
const HATCH = "repeating-linear-gradient(135deg, var(--ink-3) 0 1px, transparent 1px 5px)";
const HATCH_WIDE = "repeating-linear-gradient(135deg, var(--line) 0 1.5px, transparent 1.5px 6px)";

/**
 * The day ruler: one tick per day, days gone filled, the rest faint, today a
 * 3 px `signal` bar reaching past both edges. Drawn with gradients so a long
 * cycle never overflows (ticks closer than their width merge into a bar).
 */
export function DayRuler({
  total,
  day,
  onInk = false,
  height = 30,
  tick = 2,
  labels,
  className,
}: {
  total: number;
  /** Today's 1-based day (≤ 0 before the start, > total once ended). */
  day: number;
  onInk?: boolean;
  height?: number;
  /** Tick width, px. */
  tick?: number;
  labels?: readonly AxisLabel[];
  className?: string;
}) {
  const g = tickGeometry(total, day);
  const ticks = (color: string) => `repeating-linear-gradient(90deg, ${color} 0 ${tick}px, transparent ${tick}px ${g.pitch}%)`;
  const past = onInk ? "currentColor" : "var(--ink)";
  const future = onInk ? "color-mix(in oklab, currentColor 22%, transparent)" : "var(--line)";
  const label = g.today !== null ? `Day ${day} of ${total}` : day > total ? `Ended · ${total} days` : `${total} days, not started`;
  return (
    <div className={cn(onInk ? "text-surface" : "text-ink", className)} data-slot="day-ruler">
      <div className="relative" style={{ height }} role="img" aria-label={label}>
        <div className="absolute inset-0" style={{ background: ticks(future) }} />
        <div className="absolute inset-0" style={{ background: ticks(past), clipPath: `inset(0 ${100 - g.filled}% 0 0)` }} data-filled={g.filled.toFixed(2)} />
        {g.today !== null ? (
          <span
            className="absolute -top-1.5 -bottom-1.5 w-[3px] -translate-x-1/2 rounded-[2px] bg-signal"
            style={{ left: `${g.today}%` }}
            data-today=""
          />
        ) : null}
      </div>
      {labels?.length ? <AxisRow labels={labels} onInk={onInk} className="mt-2.5" /> : null}
    </div>
  );
}

/** Date labels positioned along a ruler or over the lanes. */
export function AxisRow({ labels, onInk = false, className }: { labels: readonly AxisLabel[]; onInk?: boolean; className?: string }) {
  return (
    <div className={cn("relative h-4 font-mono text-[12px] leading-4 font-medium", onInk ? "text-on-ink-2" : "text-ink-3", className)} aria-hidden>
      {labels.map((label) => (
        <span
          key={`${label.text}-${label.percent}`}
          className={cn(
            "absolute whitespace-nowrap",
            label.align === "center" && "-translate-x-1/2",
            label.today && (onInk ? "font-semibold text-surface" : "font-semibold text-ink"),
          )}
          style={label.align === "end" ? { right: 0 } : { left: `${label.percent}%` }}
        >
          {label.text}
        </span>
      ))}
    </div>
  );
}

/** A peptide's phase lane on its card (R3) or in the builder (R4c): bar height follows dose, breaks hatched. */
export function CardLane({ bars, todayPercent, height = 18, className }: { bars: readonly LaneBar[]; todayPercent: number | null; height?: number; className?: string }) {
  return (
    <div className={cn("relative", className)} style={{ height }} aria-hidden data-slot="lane">
      {bars.map((bar, i) => (
        <span
          key={i}
          className={cn("absolute bottom-0 rounded-[3px]", bar.kind === "active" ? "bg-ink" : "border border-ink-3")}
          style={{
            left: `${bar.left}%`,
            width: `max(2px, calc(${bar.width}% - 2px))`,
            height: barHeight(bar, LANE_HEIGHTS.card),
            ...(bar.kind === "break" ? { background: HATCH } : {}),
          }}
          data-kind={bar.kind}
        />
      ))}
      {todayPercent !== null ? (
        <i className="absolute top-0 -bottom-1 w-[3px] -translate-x-1/2 rounded-[2px] bg-signal" style={{ left: `${todayPercent}%` }} data-today="" />
      ) : null}
    </div>
  );
}

export type TimelineRow = {
  planId: string;
  name: string;
  /** "7:30 AM", and "5 mg/mL · 5 units" when there is a mix. */
  sub: string;
  meta: string;
  bars: readonly (LaneBar & { text: string })[];
};

/**
 * D2's timeline: a 180 px label column and every peptide's lane on one date
 * axis, bars labelled with their dose, breaks hatched, one today line
 * through all lanes.
 */
export function Timeline({ rows, axis, todayPercent }: { rows: readonly TimelineRow[]; axis: readonly AxisLabel[]; todayPercent: number | null }) {
  return (
    <section aria-label="Timeline" className="rounded-[24px] border border-line bg-surface px-6 py-[18px]" data-testid="cycle-timeline">
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-5">
        <span />
        <AxisRow labels={axis} className="mb-2" />
        {rows.map((row) => (
          <div key={row.planId} className="contents" data-testid="timeline-row">
            <div className="border-t border-line py-[18px]">
              <div className="text-base font-semibold">{row.name}</div>
              {row.sub ? <div className="mt-0.5 text-[13px] text-ink-2">{row.sub}</div> : null}
              {row.meta ? <div className="mt-1 font-mono text-[12px] font-medium text-ink-3">{row.meta}</div> : null}
            </div>
            <div className="relative flex items-center border-t border-line py-[18px]">
              <div className="relative h-[34px] w-full">
                {row.bars.map((bar, i) => (
                  <span
                    key={i}
                    title={bar.text}
                    className={cn(
                      "absolute bottom-0 flex items-center overflow-hidden rounded-[8px] px-2.5 text-[13px] font-semibold whitespace-nowrap",
                      bar.kind === "active" ? "bg-ink text-surface" : "justify-center border border-ink-3 text-ink-2",
                    )}
                    style={{
                      left: `${bar.left}%`,
                      width: `max(3px, calc(${bar.width}% - 3px))`,
                      height: barHeight(bar, LANE_HEIGHTS.timeline),
                      ...(bar.kind === "break" ? { background: HATCH_WIDE } : {}),
                    }}
                    data-kind={bar.kind}
                  >
                    <span className="truncate">{bar.text}</span>
                  </span>
                ))}
              </div>
              {todayPercent !== null ? (
                <i className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-[2px] bg-signal" style={{ left: `${todayPercent}%` }} aria-hidden data-today="" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
