import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A standing notice in a screen's flow (design v3): 14/20 `ink-2` on
 * `sunken`, with the info icon. Same shape as the `low-tint` "not offered"
 * warning it can sit beside, in the neutral tone: it informs, nothing is
 * wrong. Placement (margins) is the caller's.
 */
export function Notice({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-[18px] bg-sunken px-4 py-3 text-[14px] leading-5 text-ink-2", className)} data-testid={testId}>
      <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
