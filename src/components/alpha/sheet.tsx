"use client";

import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";
import { useAlphaPortal } from "./root";
import { ToastSlot } from "./toast";
import { useIsLaptop } from "./use-laptop";

/** Whether the enclosing Sheet is open (its content still shows while it closes). */
const SheetOpenContext = createContext(true);

/**
 * Sheet (§7.11–7.12), one component for both widths: a bottom sheet on the
 * phone (swipe down to dismiss; 320 ms up, 240 ms down) and a 420 px
 * right-hand drawer on a laptop, over the main area only. Built on Base UI's
 * Drawer: focus is trapped, Esc closes, the title names the dialog. Motion and
 * layout live in src/styles/alpha/components.css. While it is open, the app's
 * toast shows inside it, above its footer (ToastSlot, src/components/alpha/toast.tsx).
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
  // An uncontrolled sheet (a SheetTrigger, defaultOpen) reports its state here.
  const [openedHere, setOpenedHere] = useState(defaultOpen ?? false);
  return (
    <Drawer.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => {
        setOpenedHere(next);
        onOpenChange?.(next);
      }}
      swipeDirection={laptop ? "right" : "down"}
    >
      <SheetOpenContext value={open ?? openedHere}>{children}</SheetOpenContext>
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
  /**
   * Full sheets start 62 px from the top; auto sheets fit their content.
   * Screen: a full-screen modal on the phone (A4 / A5: a nav bar with
   * Cancel, the title and the context in mono under it), the same drawer
   * as the others on a laptop.
   */
  size?: "full" | "auto" | "screen";
  /** Pinned above the home indicator: an outline + a primary, or one primary. */
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const container = useAlphaPortal();
  const open = useContext(SheetOpenContext);
  return (
    <Drawer.Portal container={container}>
      <Drawer.Backdrop className="alpha-sheet-backdrop" />
      <Drawer.Viewport className="alpha-sheet-viewport">
        <Drawer.Popup className={cn("alpha-sheet", className)} data-size={size}>
          <div className="alpha-sheet-grabber" aria-hidden />
          {size === "screen" ? (
            <div className="grid h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-5 laptop:flex laptop:h-auto laptop:items-center laptop:gap-3 laptop:px-6 laptop:pt-5 laptop:pb-2">
              <Drawer.Close className="cursor-pointer justify-self-start text-[17px] text-signal-ink laptop:hidden">Cancel</Drawer.Close>
              <div className="flex min-w-0 flex-col text-center laptop:flex-1 laptop:flex-col-reverse laptop:text-left">
                <Drawer.Title className="text-[17px] font-semibold laptop:mt-0.5 laptop:text-[24px] laptop:leading-[1.15] laptop:tracking-[-0.025em]">
                  {title}
                </Drawer.Title>
                {context ? (
                  <div className="font-mono text-[12px] text-ink-3 laptop:text-[13px] laptop:font-medium" data-testid="sheet-context">
                    {context}
                  </div>
                ) : null}
              </div>
              <Drawer.Close
                aria-label="Close"
                className="hidden size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sunken text-ink laptop:flex"
              >
                <X className="size-[18px]" aria-hidden />
              </Drawer.Close>
            </div>
          ) : (
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
          )}
          <Drawer.Content className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3.5 laptop:px-6">
            {children}
          </Drawer.Content>
          <ToastSlot open={open} footer={Boolean(footer)} />
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
