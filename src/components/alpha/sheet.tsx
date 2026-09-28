"use client";

import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlphaPortal } from "./root";
import { useIsLaptop } from "./use-laptop";

/**
 * Sheet (§7.11–7.12), one component for both widths: a bottom sheet on the
 * phone (swipe down to dismiss; 320 ms up, 240 ms down) and a 420 px
 * right-hand drawer on a laptop, over the main area only. Built on Base UI's
 * Drawer: focus is trapped, Esc closes, the title names the dialog. Motion and
 * layout live in src/styles/alpha/components.css.
 */
export function Sheet({
  open,
  onOpenChange,
  defaultOpen,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const laptop = useIsLaptop();
  return (
    <Drawer.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      swipeDirection={laptop ? "right" : "down"}
    >
      {children}
    </Drawer.Root>
  );
}

export const SheetTrigger = Drawer.Trigger;
export const SheetClose = Drawer.Close;

export function SheetContent({
  title,
  context,
  contextTone = "default",
  size = "full",
  footer,
  leading,
  className,
  children,
}: {
  title: React.ReactNode;
  /** Above the title: an icon well (R17's shield). */
  leading?: React.ReactNode;
  /** Mono 13 line above the title ("Due 9:00 AM · Thu"), coloured by state. */
  context?: React.ReactNode;
  contextTone?: "default" | "signal" | "missed";
  /** Full sheets start 62 px from the top; auto sheets fit their content. */
  size?: "full" | "auto";
  /** Pinned above the home indicator: an outline + a primary, or one primary. */
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const container = useAlphaPortal();
  return (
    <Drawer.Portal container={container}>
      <Drawer.Backdrop className="alpha-sheet-backdrop" />
      <Drawer.Viewport className="alpha-sheet-viewport">
        <Drawer.Popup className={cn("alpha-sheet", className)} data-size={size}>
          <div className="alpha-sheet-grabber" aria-hidden />
          <div className="flex items-start gap-3 px-5 pt-3 pb-2 laptop:items-center laptop:px-6 laptop:pt-5">
            <div className="min-w-0 flex-1">
              {leading ? <div className="mb-3.5">{leading}</div> : null}
              {context ? (
                <div
                  className={cn(
                    "font-mono text-[13px] font-medium",
                    contextTone === "signal" && "text-signal-ink",
                    contextTone === "missed" && "text-missed",
                    contextTone === "default" && "text-ink-3",
                  )}
                >
                  {context}
                </div>
              ) : null}
              <Drawer.Title className="mt-0.5 text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] laptop:text-[24px]">
                {title}
              </Drawer.Title>
            </div>
            <Drawer.Close
              aria-label="Close"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sunken text-ink laptop:size-10"
            >
              <X className="size-[18px]" aria-hidden />
            </Drawer.Close>
          </div>
          <Drawer.Content className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3.5 laptop:px-6">
            {children}
          </Drawer.Content>
          {footer ? (
            <div className="flex gap-2 border-t border-line px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] laptop:px-6 laptop:pb-5 [&>*:last-child]:flex-1">
              {footer}
            </div>
          ) : null}
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  );
}
