import { Info, TriangleAlert } from "lucide-react";
import type { LineSpacing, SyringeCapacity } from "@/lib/calculator/calculator";
import { syringeScale, type SyringeFlag } from "@/lib/alpha/syringe-scale";
import { cn } from "@/lib/utils";

// Graduated gauges (§7.8): every number carries its scale. On the Now block
// (`onInk`) marks draw in currentColor at reduced strength, so the same
// markup works on ink (light mode) and near-white (dark mode).

const TICK = {
  minor: { height: 7, width: 1, ink: 1, onInk: 0.45 },
  mid: { height: 9, width: 1, ink: 1, onInk: 0.6 },
  major: { height: 13, width: 1.5, ink: 1, onInk: 0.8 },
} as const;

/**
 * Syringe ruler (height 56): a 14 px barrel filled with `signal` to the value,
 * the syringe's real lines below it (100-unit every 2, 50-unit every 1,
 * 30-unit every 0.5), a 2 × 37 marker at the value and mono labels. Never
 * rounds: a value between lines, or over capacity, gets a note.
 */
export function SyringeRuler({
  units,
  unitsText,
  capacity,
  lineSpacing,
  onInk = false,
  notes = true,
  className,
}: {
  /** Exact units, a plain decimal string (e.g. the calculator's `units`). */
  units: string;
  unitsText?: string;
  capacity: SyringeCapacity;
  lineSpacing?: LineSpacing;
  onInk?: boolean;
  /** Show the between-lines / over-capacity note under the ruler. */
  notes?: boolean;
  className?: string;
}) {
  const scale = syringeScale({ units, unitsText, capacity, lineSpacing });
  if (!scale) return null;
  const label = `${scale.unitsText} units on a ${capacity}-unit syringe`;

  return (
    <div className={cn("text-ink", onInk && "text-surface", className)} data-slot="syringe-ruler">
      <div className="relative h-14" role="img" aria-label={label}>
        <div
          className={cn("absolute inset-x-0 top-0 h-3.5 overflow-hidden rounded-[5px]", !onInk && "bg-sunken")}
          style={onInk ? { background: "color-mix(in oklab, currentColor 14%, transparent)" } : undefined}
        >
          <div
            className="h-full bg-signal transition-[width] duration-300 ease-alpha motion-reduce:transition-none"
            style={{ width: `${scale.fillPercent}%` }}
          />
          {scale.overCapacity ? (
            <div
              className="absolute inset-y-0 right-0 w-[12%] border-l-2 border-missed"
              style={{
                background:
                  "repeating-linear-gradient(135deg, var(--missed) 0 2px, color-mix(in oklab, var(--missed) 25%, transparent) 2px 6px)",
              }}
              data-overflow=""
            />
          ) : null}
        </div>
        <svg className="absolute inset-x-0 top-[18px] h-[13px] w-full overflow-visible" aria-hidden>
          {scale.ticks.map((tick) => {
            const spec = TICK[tick.kind];
            return (
              <line
                key={tick.units}
                x1={`${tick.percent}%`}
                x2={`${tick.percent}%`}
                y1={0}
                y2={spec.height}
                stroke="currentColor"
                strokeWidth={spec.width}
                strokeOpacity={onInk ? spec.onInk : spec.ink}
                shapeRendering="crispEdges"
                data-kind={tick.kind}
              />
            );
          })}
        </svg>
        {scale.markerPercent !== null ? (
          <div
            className="absolute top-[-5px] -ml-px h-[37px] w-0.5 bg-current transition-[left] duration-300 ease-alpha motion-reduce:transition-none"
            style={{ left: `${scale.markerPercent}%` }}
            data-marker=""
          />
        ) : null}
        <div className={cn("absolute inset-x-0 top-10 font-mono text-[12px] leading-4", onInk ? "text-on-ink-2" : "text-ink-3")}>
          {scale.ticks
            .filter((tick) => tick.label !== null)
            .map((tick) => (
              <span
                key={tick.units}
                className={cn(
                  "absolute -translate-x-1/2 font-medium",
                  tick.label === scale.labelAtValue && (onInk ? "font-semibold text-surface" : "font-semibold text-ink"),
                )}
                style={{ left: `${tick.percent}%` }}
              >
                {tick.label}
              </span>
            ))}
        </div>
      </div>
      {notes
        ? scale.flags.map((flag) => <SyringeNote key={flag.kind} flag={flag} onInk={onInk} className="mt-2" />)
        : null}
    </div>
  );
}

/** Info note (between lines, unknown lines) or a `missed` warning (over capacity). */
export function SyringeNote({ flag, onInk = false, className }: { flag: SyringeFlag; onInk?: boolean; className?: string }) {
  const over = flag.kind === "over-capacity";
  const Icon = over ? TriangleAlert : Info;
  return (
    <p
      role={over ? "alert" : undefined}
      data-flag={flag.kind}
      className={cn(
        "flex items-start gap-1.5 text-[13px] leading-[18px] font-medium",
        over ? (onInk ? "text-on-ink-missed" : "text-missed") : onInk ? "text-on-ink-2" : "text-ink-2",
        className,
      )}
    >
      <Icon className="mt-px size-[15px] shrink-0" aria-hidden />
      {flag.message}
    </p>
  );
}

/**
 * Cycle ticks (§7.8): one tick per day. Past days `ink` (on the Now block:
 * currentColor), future days `line` (22% currentColor), today a 3 px `signal`
 * bar reaching 6 px above and below. `today` is the 1-based day number (0
 * before the start; past `days` once ended).
 */
export function TickBar({
  days,
  today,
  onInk = false,
  labels,
  className,
}: {
  days: number;
  today: number;
  onInk?: boolean;
  /** Spread along the bar (e.g. "Sep 1", "Today", "Nov 23"). */
  labels?: readonly React.ReactNode[];
  className?: string;
}) {
  const count = Math.max(1, Math.floor(days));
  const current = today >= 1 && today <= count ? today : null;
  const future = onInk ? "color-mix(in oklab, currentColor 22%, transparent)" : "var(--line)";
  return (
    <div className={cn(onInk ? "text-surface" : "text-ink", className)} data-slot="tick-bar">
      <div
        className="relative flex h-7 gap-px"
        role="img"
        aria-label={current ? `Day ${current} of ${count}` : today > count ? `Ended · ${count} days` : `${count} days, not started`}
      >
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="flex flex-1 justify-center">
            <i
              className="block h-full w-full max-w-[3px] min-w-[1px] rounded-[1px]"
              style={{ background: index + 1 < today ? "currentColor" : future }}
            />
          </span>
        ))}
        {current ? (
          <span
            className="absolute -top-1.5 -bottom-1.5 w-[3px] -translate-x-1/2 rounded-[2px] bg-signal"
            style={{ left: `${((current - 0.5) / count) * 100}%` }}
            data-today=""
          />
        ) : null}
      </div>
      {labels && labels.length > 0 ? (
        <div
          className={cn(
            "mt-2 flex justify-between font-mono text-[12px] leading-4 font-medium",
            onInk ? "text-on-ink-2" : "text-ink-3",
          )}
        >
          {labels.map((text, index) => (
            <span key={index}>{text}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Level meter (§7.8) for a vial or stock: a 10 px bar, radius 5, `sunken`,
 * filled `ink` (or `low-fill` when low) with 2 px graduations every 10%. The
 * table variant is 6 px with no graduations.
 */
export function LevelMeter({
  value,
  low = false,
  variant = "graduated",
  label,
  className,
}: {
  /** 0–1. */
  value: number;
  low?: boolean;
  variant?: "graduated" | "table";
  /** Accessible name, e.g. "BPC-157 vial remaining". */
  label: string;
  className?: string;
}) {
  const fraction = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      data-low={low || undefined}
      className={cn(
        "relative overflow-hidden bg-sunken",
        variant === "graduated" ? "h-2.5 rounded-[5px]" : "h-1.5 rounded-[3px]",
        className,
      )}
    >
      <div className={cn("h-full", low ? "bg-low-fill" : "bg-ink")} style={{ width: `${fraction * 100}%` }} />
      {variant === "graduated" ? (
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              "repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), var(--surface) calc(10% - 2px) 10%)",
          }}
        />
      ) : null}
    </div>
  );
}
