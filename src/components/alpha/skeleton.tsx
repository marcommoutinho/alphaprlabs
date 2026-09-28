import { cn } from "@/lib/utils";

/**
 * Skeleton (§7.16): `sunken` blocks at the exact size and place of the real
 * content, inner pieces in `line`, with a slow pulse (opacity 1 ↔ .6 over
 * 1.6 s; still under reduced motion). Put `aria-busy` on the container that
 * is loading (see SkeletonRegion).
 */
export function Skeleton({
  className,
  inner = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** A piece inside a skeleton block: `line` instead of `sunken`. */
  inner?: boolean;
}) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn(inner ? "bg-line" : "bg-sunken", "rounded-[12px] motion-safe:animate-alpha-pulse", className)}
      {...props}
    />
  );
}

/** A loading region: aria-busy, with an accessible "Loading" name. */
export function SkeletonRegion({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" aria-label={label} role="status" className={className}>
      {children}
    </div>
  );
}
