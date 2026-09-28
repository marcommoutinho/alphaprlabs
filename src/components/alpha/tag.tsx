import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Tags (§7.19): about 22 tall, radius 6, 12/600.
 *   now      "Now", "In your cycle"   signal-tint + signal-ink
 *   low      "Low", "Draft"           low-tint + low
 *   role     "Researcher"             sunken + ink-2
 *   outline  "Not offered"            surface + line + ink-2
 */
export const tagVariants = cva(
  "inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-[7px] text-[12px] leading-none font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        now: "bg-signal-tint text-signal-ink",
        low: "bg-low-tint text-low",
        role: "bg-sunken text-ink-2",
        outline: "border border-line bg-surface text-ink-2",
      },
      mono: { true: "font-mono", false: "" },
    },
    defaultVariants: { tone: "role", mono: false },
  },
);

export function Tag({
  tone,
  mono,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof tagVariants>) {
  return <span data-slot="tag" className={cn(tagVariants({ tone, mono }), className)} {...props} />;
}

/**
 * Status pill (§7.7 "Due now"): `signal` fill, `on-signal` text 13/600,
 * height 26, radius 99, with a 6 px dot.
 */
export function Pill({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="pill"
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full bg-signal px-2.5 text-[13px] font-semibold text-on-signal",
        className,
      )}
      {...props}
    >
      <i className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
