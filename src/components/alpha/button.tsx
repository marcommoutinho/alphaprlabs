"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Design v3 buttons (§7.1). Signal (`primary`) records something; `ink`
 * navigates or continues; `outline` is the alternative. Sizes: lg 56 (radius
 * 16), md 44 (radius 12), sm 40 (radius 10). Pressed: scale .98 over 120 ms.
 * Use `buttonVariants` to style a link as a button.
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 font-semibold whitespace-nowrap select-none",
    "transition-[scale,opacity] duration-120 ease-out active:scale-98 motion-reduce:active:scale-100",
    "disabled:cursor-default disabled:opacity-40 data-disabled:cursor-default data-disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        primary: "bg-signal text-on-signal",
        ink: "bg-ink text-surface",
        outline: "border border-line bg-surface text-ink",
        soft: "bg-sunken text-ink",
        ghost: "bg-transparent text-signal-ink",
        /** Secondary action inside the Now block ("Details"). */
        "ghost-on-ink": "bg-[color-mix(in_oklab,currentColor_12%,transparent)] text-surface",
        "destructive-text": "border border-line bg-surface text-missed",
      },
      size: {
        lg: "h-14 rounded-btn px-5 text-base",
        md: "h-11 rounded-[12px] px-4 text-[15px]",
        sm: "h-10 rounded-[10px] px-3.5 text-[15px]",
        /** Round 44 px icon button (close, +); give it an aria-label. */
        icon: "size-11 rounded-full [&_svg:not([class*='size-'])]:size-[18px]",
      },
      block: { true: "w-full", false: "" },
    },
    compoundVariants: [
      { variant: "primary", size: "lg", className: "text-[17px]" },
      { variant: "ink", size: "lg", className: "text-[17px]" },
    ],
    defaultVariants: { variant: "primary", size: "lg", block: false },
  },
);

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** A request is in flight: shows `savingLabel` and disables the button. */
    saving?: boolean;
    savingLabel?: string;
  };

export function Button({
  className,
  variant,
  size,
  block,
  saving = false,
  savingLabel = "Saving…",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || saving}
      aria-busy={saving || undefined}
      {...props}
    >
      {saving ? savingLabel : children}
    </ButtonPrimitive>
  );
}
