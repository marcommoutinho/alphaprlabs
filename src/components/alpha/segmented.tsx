"use client";

import Link from "next/link";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Segmented control (§7.3): a `sunken` track (radius 12, padding 3) whose
 * selected segment is `surface` with the seg shadow and 600 weight. Heights:
 * md 44 (phone), sm 40 (laptop), mini 32 (inline unit toggles).
 */
export const segmentedTrack = cva("grid auto-cols-fr grid-flow-col bg-sunken p-[3px]", {
  variants: {
    size: {
      md: "h-11 rounded-[12px]",
      sm: "h-10 rounded-[12px]",
      mini: "h-8 rounded-[9px]",
    },
  },
  defaultVariants: { size: "md" },
});

export const segmentedItem = cva(
  [
    "flex min-w-0 cursor-pointer items-center justify-center truncate px-3 font-medium text-ink-2 select-none",
    "transition-[background-color,box-shadow,color] duration-150",
    "data-pressed:bg-surface data-pressed:font-semibold data-pressed:text-ink data-pressed:shadow-seg",
    "aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-seg",
    "focus-visible:outline-offset-0",
  ],
  {
    variants: {
      size: { md: "rounded-[9px] text-[15px]", sm: "rounded-[9px] text-[14px]", mini: "rounded-[7px] px-2.5 text-[14px]" },
      mono: { true: "font-mono", false: "" },
    },
    defaultVariants: { size: "md", mono: false },
  },
);

export type SegmentOption<V extends string> = { value: V; label: React.ReactNode };

/** One choice from a few (ToggleGroup, single). The selection can't be cleared. */
export function Segmented<V extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  mono = false,
  className,
  ...aria
}: {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  size?: "md" | "sm" | "mini";
  /** Mono labels for numbers (`100 | 50 | 30`) and units (`mcg | mg`). */
  mono?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ToggleGroup<V>
      value={[value]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined && chosen !== value) onValueChange(chosen);
      }}
      className={cn(segmentedTrack({ size }), className)}
      {...aria}
    >
      {options.map((option) => (
        <Toggle<V> key={option.value} value={option.value} className={segmentedItem({ size, mono })}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** The same control as navigation between pages: links with aria-current. */
export function SegmentedLinks({
  links,
  current,
  size = "md",
  label,
  className,
}: {
  links: readonly { key: string; label: string; href: string }[];
  current: string | null;
  size?: "md" | "sm";
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(segmentedTrack({ size }), className)}>
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={segmentedItem({ size })}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
