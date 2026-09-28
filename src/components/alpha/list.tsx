import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StateGlyph } from "./state-glyph";

/**
 * Grouped list (§7.5): `surface`, 1 px `line`, radius 20, rows divided by
 * `line`. Put a <GroupLabel> above it.
 */
export function Group({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="group"
      className={cn("divide-y divide-line overflow-hidden rounded-group border border-line bg-surface", className)}
      {...props}
    />
  );
}

/** 13/600 `ink-2`, 20 px side margin, 8 px above the group. */
export function GroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-2 px-5 text-[13px] font-semibold text-ink-2", className)} {...props} />;
}

type RowProps = {
  title: React.ReactNode;
  /** 13 px `ink-2` sub-line. */
  sub?: React.ReactNode;
  /** Mono 12 px `ink-3` meta line (dates, strengths). */
  meta?: React.ReactNode;
  /** A glyph, icon well or avatar before the text. */
  leading?: React.ReactNode;
  /** Right side: a value in `ink-2`. */
  value?: React.ReactNode;
  /** Right side: a count, 20/600. */
  count?: React.ReactNode;
  /** Any other right-side content (a switch, a button). */
  trailing?: React.ReactNode;
  chevron?: boolean;
  /** Settings rows are 56 tall; content rows 64. */
  density?: "settings" | "content";
  href?: string;
  onClick?: () => void;
  className?: string;
};

/** One row of a group. A link when `href` is set, a button with `onClick`. */
export function Row({
  title,
  sub,
  meta,
  leading,
  value,
  count,
  trailing,
  chevron = false,
  density = "content",
  href,
  onClick,
  className,
}: RowProps) {
  const classes = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-left text-ink",
    density === "settings" ? "min-h-14" : "min-h-16",
    (href || onClick) && "cursor-pointer transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]",
    className,
  );
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-[22px] font-semibold">{title}</span>
        {sub ? <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-2">{sub}</span> : null}
        {meta ? <span className="mt-0.5 block font-mono text-[12px] leading-4 text-ink-3">{meta}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-[15px] text-ink-2">{value}</span> : null}
      {count !== undefined && count !== null ? (
        <span className="shrink-0 text-[20px] font-semibold tracking-[-0.015em]">{count}</span>
      ) : null}
      {trailing}
      {chevron ? <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden /> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/**
 * Standalone status row (§7.5) on a tint: overdue (`missed-tint`, diamond)
 * or low (`low-tint`, low bars), with a title, a status line and one 44 px
 * action or a chevron.
 */
export function StatusRow({
  tone,
  title,
  status,
  action,
  href,
  className,
  testId,
}: {
  tone: "overdue" | "low";
  title: React.ReactNode;
  status: React.ReactNode;
  action?: React.ReactNode;
  href?: string;
  className?: string;
  testId?: string;
}) {
  const classes = cn(
    "flex min-h-16 items-center gap-3 rounded-[18px] py-3 pr-3 pl-4 text-ink",
    tone === "overdue" ? "bg-missed-tint" : "bg-low-tint",
    className,
  );
  const body = (
    <>
      <StateGlyph state={tone} />
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-[22px] font-semibold">{title}</span>
        <span
          className={cn(
            "mt-0.5 block text-[13px] leading-[18px] font-semibold",
            tone === "overdue" ? "text-missed" : "text-low",
          )}
        >
          {status}
        </span>
      </span>
      {action}
      {href && !action ? <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden /> : null}
    </>
  );
  return href && !action ? (
    <Link href={href} className={classes} data-tone={tone} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={classes} data-tone={tone} data-testid={testId}>
      {body}
    </div>
  );
}
