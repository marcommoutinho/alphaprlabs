import { ChevronLeft } from "lucide-react";
import Link from "@/components/alpha/link";

/** "‹ Ledger", "‹ Stock", "‹ Cycles": a page's own back link, in `signal-ink` (a nav-bar action). */
export function BackBar({ href, label }: { href: string; label: string }) {
  return (
    <div className="flex h-11 items-center pr-3 pl-1.5 laptop:mb-2 laptop:h-auto laptop:pl-0">
      <Link href={href} className="flex items-center gap-0.5 text-[17px] text-signal-ink laptop:text-[15px]" data-testid="back-link">
        <ChevronLeft className="size-[26px] laptop:size-5" aria-hidden />
        {label}
      </Link>
    </div>
  );
}
