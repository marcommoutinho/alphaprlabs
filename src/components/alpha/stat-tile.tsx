import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stat tile (§7.10): `surface` + `line`, radius 20. Label → reading (unit in
 * mono `ink-2`) → context. A change is an arrow plus words, never red or
 * green.
 */
export function StatTile({
  label,
  value,
  unit,
  context,
  change,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  context?: React.ReactNode;
  /** Direction of the change described in `context`. */
  change?: "up" | "down";
  /** `missed` colours the reading (e.g. Missed 1), for a state that is also named. */
  tone?: "missed";
  className?: string;
}) {
  const Arrow = change === "up" ? ArrowUpRight : change === "down" ? ArrowDownRight : null;
  return (
    <div data-slot="stat-tile" className={cn("rounded-group border border-line bg-surface p-4", className)}>
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span
          className={cn(
            "text-[34px] leading-none font-semibold tracking-[-0.03em]",
            tone === "missed" && "text-missed",
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-[15px] font-medium text-ink-2">{unit}</span> : null}
      </div>
      {context ? (
        <div className={cn("mt-1 flex items-center gap-1 text-[13px]", Arrow ? "text-ink-2" : "text-ink-3")}>
          {Arrow ? <Arrow className="size-3.5 shrink-0" aria-hidden /> : null}
          <span>{context}</span>
        </div>
      ) : null}
    </div>
  );
}
