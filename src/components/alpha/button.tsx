"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { VariantProps } from "class-variance-authority";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";
import { OFFLINE_REASON, useOnline } from "./online";

// The variants live in ./button-variants (a plain module server components can use).
export { buttonVariants };

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** A request is in flight: shows `savingLabel` and disables the button. */
    saving?: boolean;
    savingLabel?: string;
    /**
     * The button saves to the server: offline (useOnline) it is disabled up
     * front, with the offline glyph and the reason (title, aria-description),
     * so a tap never fails silently or waits for a connection. The offline
     * bar says so in words.
     */
    needsConnection?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  block,
  saving = false,
  savingLabel = "Saving…",
  needsConnection = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const online = useOnline();
  const offline = needsConnection && !online && !saving;
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block }), offline && "[&>svg:not(.offline-glyph)]:hidden", className)}
      disabled={disabled || saving || offline}
      aria-busy={saving || undefined}
      data-offline={offline || undefined}
      title={offline ? OFFLINE_REASON : undefined}
      aria-description={offline ? OFFLINE_REASON : undefined}
      {...props}
    >
      {saving ? (
        savingLabel
      ) : offline ? (
        <>
          <WifiOff aria-hidden className="offline-glyph size-4 shrink-0" strokeWidth={2.2} data-testid="offline-glyph" />
          {children}
        </>
      ) : (
        children
      )}
    </ButtonPrimitive>
  );
}
