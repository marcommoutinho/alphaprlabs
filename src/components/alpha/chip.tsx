"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chip (§7.4): 44 tall, radius 12, 15 px. Unselected `surface` + `line`;
 * selected `ink` fill with `surface` text at 600. Multi-select chips also show
 * a check; single-select (injection site) chips don't. The last-used choice
 * has a dashed `ink-3` border.
 */
const chipClass = cn(
  "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-chip border border-line bg-surface px-3.5 text-[15px] text-ink select-none",
  "transition-[background-color,color,border-color] duration-150",
  "data-pressed:border-ink data-pressed:bg-ink data-pressed:font-semibold data-pressed:text-surface",
  "data-[last-used]:not-data-pressed:border-dashed data-[last-used]:not-data-pressed:border-ink-3",
);

export type ChipOption = {
  value: string;
  label: React.ReactNode;
  /** The previous choice (e.g. last injection site): dashed border. */
  lastUsed?: boolean;
};

export function ChipGroup({
  options,
  value,
  onValueChange,
  multiple = false,
  showCheck = multiple,
  className,
  ...aria
}: {
  options: readonly ChipOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /** Several at once (unwanted effects) or one (injection site). */
  multiple?: boolean;
  showCheck?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ToggleGroup
      multiple={multiple}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      className={cn("flex flex-wrap gap-2", className)}
      {...aria}
    >
      {options.map((option) => (
        <Toggle key={option.value} value={option.value} className={chipClass} data-last-used={option.lastUsed || undefined}>
          {showCheck && value.includes(option.value) ? <Check className="size-[15px]" strokeWidth={2.5} aria-hidden /> : null}
          {option.label}
          {option.lastUsed ? <span className="sr-only"> (last used)</span> : null}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** "+ Other", "+ Strength": transparent with a dashed border and a plus. */
export function AddChip({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-chip border border-dashed border-ink-3 bg-transparent px-3.5 text-[15px] text-ink-2",
        className,
      )}
      {...props}
    >
      <Plus className="size-4" aria-hidden />
      {children}
    </button>
  );
}
