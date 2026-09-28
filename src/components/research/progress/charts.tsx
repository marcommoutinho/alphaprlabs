import { cn } from "@/lib/utils";
import type { DoseTrack, FeelingPoint, MeasurePoint } from "@/lib/progress/screen";

// R5 / D3 charts. Drawn in a stretched SVG (preserveAspectRatio "none", with
// non-scaling strokes) so the x-scale matches the dose lanes and the axis
// under them exactly; markers and the pre-cycle area are HTML on top, so
// they keep their shape at any width. Decorative: the numbers they show are
// in the text beside them (average, change, check-in rows).

const W = 326;
/** Feeling 5 at the top line, 1 at the base line (R5's 112-high chart). */
const feelingY = (feeling: number) => 104 - (feeling - 1) * 24.5;
const FEELING_H = 112;

/** Runs of consecutive days with a value: a gap breaks the line. */
function runs<T>(points: readonly T[], has: (p: T) => boolean): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  for (const p of points) {
    if (has(p)) current.push(p);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

/** The hatched "before the cycle" area over the first `fraction` of a chart. */
function PreCycle({ fraction, onInk }: { fraction: number | null; onInk: boolean }) {
  if (fraction === null || fraction <= 0) return null;
  return (
    <div
      aria-hidden
      data-slot="pre-cycle"
      className="absolute inset-y-0 left-0"
      style={{
        width: `${fraction * 100}%`,
        background: onInk
          ? "repeating-linear-gradient(135deg, color-mix(in oklab, var(--surface) 16%, transparent) 0 2px, transparent 2px 6px)"
          : "var(--paper)",
      }}
    />
  );
}

/** The feeling line over the range, gaps as gaps, the latest check-in's point in signal. */
export function FeelingChart({
  points,
  preCycle,
  className,
}: {
  points: readonly FeelingPoint[];
  preCycle: number | null;
  /** Give it its height (R5 112 px, D3 150 px). */
  className?: string;
}) {
  const segments = runs(points, (p) => p.feeling !== null);
  // The latest day with a check-in (today's, or the last before a gap up to today).
  const last = points.findLast((p) => p.feeling !== null);
  return (
    <div className={cn("relative", className)} data-testid="feeling-chart" data-points={points.filter((p) => p.feeling !== null).length}>
      <PreCycle fraction={preCycle} onInk />
      <svg viewBox={`0 0 ${W} ${FEELING_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {[6, 55].map((y) => (
          <line key={y} x1={0} x2={W} y1={y} y2={y} stroke="color-mix(in oklab, var(--surface) 14%, transparent)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} x2={W} y1={104} y2={104} stroke="color-mix(in oklab, var(--surface) 30%, transparent)" vectorEffect="non-scaling-stroke" />
        {segments
          .filter((s) => s.length > 1)
          .map((s) => (
            <polyline
              key={s[0].day}
              fill="none"
              stroke="var(--surface)"
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={s.map((p) => `${(p.x * W).toFixed(1)},${feelingY(p.feeling!)}`).join(" ")}
            />
          ))}
      </svg>
      {segments
        .filter((s) => s.length === 1 && s[0] !== last)
        .map(([p]) => (
          <i
            key={p.day}
            aria-hidden
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface"
            style={{ left: `${p.x * 100}%`, top: `${(feelingY(p.feeling!) / FEELING_H) * 100}%` }}
          />
        ))}
      {last?.feeling ? (
        <i
          aria-hidden
          data-slot="latest-point"
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-signal"
          style={{ left: `${last.x * 100}%`, top: `${(feelingY(last.feeling) / FEELING_H) * 100}%`, boxSizing: "content-box" }}
        />
      ) : null}
    </div>
  );
}

/** Each peptide's doses as ticks; today's still to take are hollow (signal outline). */
/** "Compound A: 3 doses taken in this range" (its lane's accessible name). */
const dosesLabel = (track: DoseTrack) => {
  const taken = track.dots.filter((d) => !d.pending).length;
  return `${track.name}: ${taken} dose${taken === 1 ? "" : "s"} taken in this range`;
};

export function DoseLanes({ tracks, className }: { tracks: readonly DoseTrack[]; className?: string }) {
  if (!tracks.length) return null;
  return (
    <div className={cn("contents", className)}>
      {tracks.map((track) => (
        <div key={track.key} className="contents" data-testid="dose-track">
          <span className="truncate font-mono text-[12px] font-medium text-on-ink-2">{track.name}</span>
          <span className="relative h-3" role="img" aria-label={dosesLabel(track)}>
            {track.dots.map((dot, i) => (
              <i
                key={i}
                title={dot.label}
                data-pending={dot.pending || undefined}
                className={cn("absolute inset-y-0 w-[3px]", dot.pending ? "border border-signal" : "bg-surface")}
                style={{ left: `calc(${dot.x * 100}% - 1.5px)` }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Axis labels under the chart and lanes. */
export function Axis({ labels, wide = false }: { labels: readonly { x: number; text: string; wide: string }[]; wide?: boolean }) {
  return (
    <div className="relative h-4 font-mono text-[12px] font-medium text-on-ink-2" aria-hidden>
      {labels.map((label, i) => {
        const text = wide ? label.wide : label.text;
        const edge = i === 0 ? { left: 0 } : i === labels.length - 1 ? { right: 0 } : { left: `${label.x * 100}%` };
        // A middle label too close to an end would overlap it: it stays hidden.
        const crowded = i > 0 && i < labels.length - 1 && (label.x < 0.16 || label.x > 0.8);
        return crowded ? null : (
          <span key={i} className="absolute whitespace-nowrap" style={edge}>
            {text}
          </span>
        );
      })}
    </div>
  );
}

/** The measurement line (R5's weight card): points on measured days, the pre-cycle area in paper. */
export function MeasureChart({ points, preCycle, className }: { points: readonly MeasurePoint[]; preCycle: number | null; className?: string }) {
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const y = (v: number) => (max === min ? 47 : 10 + ((max - v) / (max - min)) * 65);
  const H = 88;
  return (
    <div className={cn("relative", className)} data-testid="measure-chart">
      <PreCycle fraction={preCycle} onInk={false} />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <line x1={0} x2={W} y1={10} y2={10} stroke="var(--line)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={85} y2={85} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        {points.length > 1 ? (
          <polyline
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            points={points.map((p) => `${(p.x * W).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
          />
        ) : null}
      </svg>
      {points.map((p) => (
        <i
          key={p.day}
          aria-hidden
          className="absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface"
          style={{ left: `${p.x * 100}%`, top: `${(y(p.value) / H) * 100}%`, boxSizing: "content-box" }}
        />
      ))}
    </div>
  );
}

/** R5's mini feeling bars: five 8×14 bars, filled up to the feeling. */
export function FeelingBars({ feeling }: { feeling: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={cn("h-3.5 w-2 rounded-[2px]", n <= feeling ? "bg-ink" : "bg-sunken")} />
      ))}
    </span>
  );
}
