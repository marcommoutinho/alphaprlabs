import { money } from "@/lib/alpha/format";
import type { DayBar, MonthRow } from "@/lib/business/overview";
import { monthDayLabel } from "@/lib/business/period";
import { cn } from "@/lib/utils";

// Business charts (COMPONENTS_AND_THEMING §7.9): bars with radius 4 on top, a
// 1 px ink baseline, a 2 px `line` stub for zero, `signal` for today or the
// current month; the stacked month bar with the cost hatched on top; outlined
// purchase bars; the gross-profit split bar. On the Now block (`onInk`) they
// draw in currentColor at reduced strength, so the same markup works on ink
// (light) and near-white (dark). Every chart has a text alternative.

/** The 135° hatch of cost segments, in `color`. */
export const hatch = (color: string) => `repeating-linear-gradient(135deg, ${color} 0 1.5px, transparent 1.5px 4px)`;
const ON_INK_70 = "color-mix(in oklab, currentColor 70%, transparent)";

/** Gap between `count` bars: 6 px for a week, tighter as bars multiply. */
const gapFor = (count: number) => (count > 45 ? 1 : count > 20 ? 2 : count > 12 ? 4 : 6);

/**
 * Split bar (§7.9): 14 px, 3 px gap; the profit share in `signal`, the cost
 * hatched with a 1 px border. Without revenue, an empty track.
 */
export function SplitBar({ profitShare, className }: { profitShare: number | null; className?: string }) {
  if (profitShare === null) {
    return (
      <div
        aria-hidden
        className={cn("h-3.5 rounded-[4px]", className)}
        style={{ background: "color-mix(in oklab, currentColor 14%, transparent)" }}
        data-slot="split-bar"
      />
    );
  }
  const percent = Math.round(profitShare * 1000) / 10;
  return (
    <div aria-hidden className={cn("flex h-3.5 gap-[3px]", className)} data-slot="split-bar" data-profit={percent}>
      {percent > 0 ? <span className="rounded-[4px] bg-signal" style={{ width: `${percent}%` }} /> : null}
      {percent < 100 ? (
        <span className="min-w-[3px] flex-1 rounded-[4px]" style={{ background: hatch(ON_INK_70), border: `1px solid ${ON_INK_70}` }} />
      ) : null}
    </div>
  );
}

/** The legend swatch for cost of stock sold (hatched) or gross profit (`signal`), 12 px. */
export function Swatch({ kind, className }: { kind: "cost" | "profit"; className?: string }) {
  return kind === "cost" ? (
    <i aria-hidden className={cn("block size-3 shrink-0 rounded-[3px]", className)} style={{ background: hatch(ON_INK_70), border: `1px solid ${ON_INK_70}` }} />
  ) : (
    <i aria-hidden className={cn("block size-3 shrink-0 rounded-[3px] bg-signal", className)} />
  );
}

/**
 * Revenue by day (A1 / A2): one bar per day, today in `signal`, zero days as
 * a 2 px stub. `onInk` draws white-on-ink (A2, inside the Now block).
 */
export function DayBars({
  days,
  onInk = false,
  className,
  label,
}: {
  days: DayBar[];
  onInk?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      data-testid="revenue-by-day"
      className={cn("grid items-end border-b", onInk ? "border-[color:color-mix(in_oklab,currentColor_50%,transparent)]" : "border-ink", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))`, gap: gapFor(days.length) }}
    >
      {days.map((day) => {
        const zero = day.height === 0;
        return (
          <i
            key={day.day}
            title={`${monthDayLabel(day.day)} · ${money(day.revenue)}`}
            data-day={day.day}
            data-today={day.today || undefined}
            className={cn(
              "block",
              zero ? (onInk ? "bg-[color:color-mix(in_oklab,currentColor_20%,transparent)]" : "bg-line") : "rounded-t-[4px]",
              !zero && (day.today ? "bg-signal" : onInk ? "bg-current" : "bg-ink"),
              onInk && !zero && "rounded-t-[3px]",
            )}
            style={{ height: zero ? 2 : `${Math.max(day.height * 100, 1.5)}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * Sales by month (A13 / D9): stacked bars, the cost hatched on top (1 px
 * `ink-3` border), gross profit below in `ink`; the current month in
 * `signal` with a 1.5 px dashed outline, offset 2.
 */
export function MonthBars({ months, gap, className }: { months: MonthRow[]; gap: number; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Sales by month: ${months.map((m) => `${m.label} ${money(m.revenue)}`).join(", ")}`}
      data-testid="sales-by-month"
      className={cn("grid grid-cols-12 items-end border-b border-ink", className)}
      style={{ gap }}
    >
      {months.map((m) => {
        if (m.barHeight === 0) return <i key={m.month} className="block h-0.5 bg-line" data-month={m.month} />;
        return (
          <span
            key={m.month}
            data-month={m.month}
            data-current={m.current || undefined}
            title={`${m.label} · revenue ${money(m.revenue)} · cost ${money(m.cost)}`}
            className={cn(
              "flex flex-col overflow-hidden rounded-t-[4px]",
              m.current && "outline-[1.5px] outline-offset-2 outline-ink outline-dashed",
            )}
            style={{ height: `${Math.max(m.barHeight * 100, 2)}%` }}
          >
            {m.costShare > 0 ? (
              <b
                className="block shrink-0 rounded-t-[4px] border border-b-0 border-ink-3"
                style={{ height: `${m.costShare * 100}%`, background: hatch("var(--ink-3)") }}
              />
            ) : null}
            <b className={cn("block flex-1", m.current ? "bg-signal" : "bg-ink")} />
          </span>
        );
      })}
    </div>
  );
}

/** Supplier purchases by month: outlined bars (1.5 px `ink`, `surface`), a 2 px stub for none, the current month dashed. */
export function PurchaseBars({ months, gap, className }: { months: MonthRow[]; gap: number; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Supplier purchases by month: ${months.map((m) => `${m.label} ${money(m.purchases)}`).join(", ")}`}
      data-testid="purchases-by-month"
      className={cn("grid grid-cols-12 items-end border-b border-ink", className)}
      style={{ gap }}
    >
      {months.map((m) =>
        m.purchasesHeight === 0 ? (
          <i key={m.month} className="block h-0.5 bg-line" data-month={m.month} data-none="" />
        ) : (
          <span
            key={m.month}
            data-month={m.month}
            title={`${m.label} · ${money(m.purchases)}`}
            className={cn("block rounded-t-[4px] border-[1.5px] border-b-0 border-ink bg-surface", m.current && "border-dashed")}
            style={{ height: `${Math.max(m.purchasesHeight * 100, 4)}%` }}
          />
        ),
      )}
    </div>
  );
}

/** The month axis: initials on a phone ("O N D …"), short names on a laptop; the current month in `ink` 600. */
export function MonthAxis({ months, style, className, gap = 0 }: { months: MonthRow[]; style: "initial" | "short"; className?: string; gap?: number }) {
  return (
    <div aria-hidden className={cn("mt-1.5 grid grid-cols-12 text-center font-mono text-[12px] font-medium text-ink-3", className)} style={{ gap }}>
      {months.map((m) => (
        <span key={m.month} className={cn(m.current && "font-semibold text-ink")}>
          {style === "initial" ? m.initial : m.label}
        </span>
      ))}
    </div>
  );
}

/** The 12-month legend: gross profit, cost of stock sold, "Sep, to date". */
export function MonthLegend({ current, className }: { current: string; className?: string }) {
  return (
    <div className={cn("mt-2.5 flex flex-wrap gap-3.5 text-[12px] text-ink-2", className)}>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="block size-2.5 rounded-[2px] bg-ink" />
        Gross profit
      </span>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="block size-2.5 rounded-[2px] border border-ink-3" style={{ background: hatch("var(--ink-3)") }} />
        Cost of stock sold
      </span>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="block size-2.5 rounded-[2px] border-[1.5px] border-dashed border-ink" />
        {current}, to date
      </span>
    </div>
  );
}

/** A 6 px share bar (§7.9 suppliers): `ink` fill, `ink-3` for the no-supplier group. */
export function ShareBar({ share, muted = false, className }: { share: number; muted?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1.5 flex-1 overflow-hidden rounded-[3px] bg-sunken", className)}>
      <i className={cn("block h-full", muted ? "bg-ink-3" : "bg-ink")} style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
    </span>
  );
}
