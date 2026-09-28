"use client";

import { Info } from "lucide-react";
import { firstIssue } from "@/lib/cycles/builder";
import { cn } from "@/lib/utils";

/**
 * R4c's validation: the first issue, plus "(+N more)", which opens the whole
 * list in order. role="alert" so a failed Continue is announced.
 */
export function Issues({ issues, open, onOpenChange }: { issues: readonly string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const summary = firstIssue(issues);
  if (!summary) return null;
  return (
    <div role="alert" className="rounded-[14px] bg-missed-tint px-3.5 py-2.5 text-[14px] leading-5" data-testid="builder-issues">
      <p className="flex items-start gap-2">
        <Info className="mt-0.5 size-[15px] shrink-0 text-missed" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold" data-testid="builder-issue">
            {summary.first}
          </span>
          {summary.more ? (
            <>
              {" "}
              <button type="button" className="font-semibold text-signal-ink underline-offset-2 hover:underline" aria-expanded={open} onClick={() => onOpenChange(!open)}>
                {open ? "(show less)" : summary.more}
              </button>
            </>
          ) : null}
        </span>
      </p>
      {open && issues.length > 1 ? (
        <ul className="mt-1.5 ml-[23px] list-disc pl-4 text-ink-2" aria-label="Everything to fix">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** R4b / R4c's peptide switcher: the current one `ink`; the others say "to set" until they have a dose. */
export function PlanChips({
  plans,
  current,
  onSelect,
}: {
  plans: readonly { key: string; name: string; set: boolean }[];
  current: number;
  onSelect: (index: number) => void;
}) {
  if (plans.length < 2) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto px-4 pt-4 laptop:px-0" role="group" aria-label="Peptides">
      {plans.map((plan, i) => (
        <button
          key={plan.key}
          type="button"
          aria-current={i === current ? "step" : undefined}
          onClick={() => onSelect(i)}
          className={cn(
            "flex h-10 shrink-0 items-center gap-2 rounded-[12px] px-3.5 text-[15px] whitespace-nowrap",
            i === current ? "bg-ink font-semibold text-surface" : "border border-line bg-surface",
          )}
        >
          {plan.name}
          {i !== current && !plan.set ? <span className="text-[12px] text-ink-3">to set</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A choice of a few on the Now block (R4b's 100 | 50 | 30): a 12 % track of
 * the block's own colour, the chosen one `surface` on `ink`-coloured text.
 */
export function OnInkSegmented<V extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid h-8 auto-cols-[44px] grid-flow-col rounded-[10px] bg-[color-mix(in_oklab,currentColor_12%,transparent)] p-0.5 font-mono text-[13px] font-medium">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center justify-center rounded-[8px]",
            option.value === value ? "bg-surface font-semibold text-ink" : "text-on-ink-2",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The builder's sticky footer on `paper` with a hairline. */
export function Footer({ children }: { children: React.ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2.5 border-t border-line bg-paper px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] laptop:px-0 laptop:pb-4">
      {children}
    </footer>
  );
}
