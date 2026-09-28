import { cn } from "@/lib/utils";

/**
 * The Now block (§7.7): the one inverted surface per screen, holding its key
 * reading. `bg-ink text-surface` in both modes (ink on light, near-white on
 * dark), radius 28 on the phone and 24 on a laptop. Secondary text inside it
 * uses `text-on-ink-2`; scales inside it draw with currentColor.
 */
export function NowBlock({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="now-block"
      className={cn("rounded-now bg-ink px-5 pt-[18px] pb-4 text-surface laptop:rounded-[24px]", className)}
      {...props}
    />
  );
}

/** Status line: pill, mono time and right-aligned context, in `on-ink-2`. */
export function NowHeader({
  pill,
  time,
  context,
}: {
  pill?: React.ReactNode;
  time?: React.ReactNode;
  context?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-on-ink-2">
      <div className="flex min-w-0 items-center gap-2">
        {pill}
        {time ? <span className="font-mono font-medium">{time}</span> : null}
      </div>
      {context ? <span className="truncate">{context}</span> : null}
    </div>
  );
}

/**
 * The reading: a big number with its unit in mono `on-ink-2`, and an optional
 * right-aligned secondary reading (mono 17/600 over a 13 caption).
 * Sizes (§5): xl 88 (104 on a laptop), l 80, m 56.
 */
export function NowReading({
  value,
  unit,
  secondary,
  caption,
  size = "xl",
  className,
}: {
  value: React.ReactNode;
  unit?: React.ReactNode;
  secondary?: React.ReactNode;
  caption?: React.ReactNode;
  size?: "xl" | "l" | "m";
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "leading-[0.8] font-semibold tracking-[-0.055em]",
            size === "xl" && "text-[88px] laptop:text-[104px]",
            size === "l" && "text-[80px]",
            size === "m" && "text-[56px] leading-none tracking-[-0.05em]",
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-[19px] text-on-ink-2">{unit}</span> : null}
      </div>
      {secondary || caption ? (
        <div className="shrink-0 text-right">
          {secondary ? <div className="font-mono text-[17px] font-semibold">{secondary}</div> : null}
          {caption ? <div className="mt-0.5 text-[13px] text-on-ink-2">{caption}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Row of actions at the bottom: a primary that flexes plus a ghost-on-ink. */
export function NowActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex gap-2 [&>*:first-child]:flex-1", className)} {...props} />;
}
