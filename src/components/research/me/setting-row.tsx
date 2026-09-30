"use client";

import { ChevronRight } from "lucide-react";
import Link from "@/components/alpha/link";
import { cn } from "@/lib/utils";

/**
 * R8's setting row: a label, its current value and a chevron; a button that
 * opens a choice sheet, or a link. The value carries data-testid
 * `${testId}-value`. Shared by Me and Me › Dose reminders.
 */
export function SettingRow({
  label,
  value,
  mono = false,
  onClick,
  href,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  onClick?: () => void;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-base">{label}</span>
      <span className={cn("shrink-0 text-ink-2", mono ? "font-mono text-[15px] font-medium" : "text-base")} data-testid={`${testId}-value`}>
        {value}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
    </>
  );
  const classes = "flex h-14 w-full cursor-pointer items-center gap-2.5 pr-3 pl-4 text-left hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]";
  return href ? (
    <Link href={href} className={classes} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes} data-testid={testId}>
      {body}
    </button>
  );
}
