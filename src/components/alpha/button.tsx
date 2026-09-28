"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

// The variants live in ./button-variants (a plain module server components can use).
export { buttonVariants };

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
