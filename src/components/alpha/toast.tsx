"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Success toasts dismiss themselves after this long (design v3 §7.15). */
export const TOAST_SUCCESS_MS = 4000;

export type ToastAction = { label: string; onAction: () => void };
export type ToastInput = { message: string; action?: ToastAction };
type Toast = ToastInput & { id: number; tone: "success" | "error" };

export type AlphaToaster = {
  /** "TB-500 · 2.5 mg logged at 9:12 AM" · Undo. role="status", gone after 4 s. */
  success: (toast: ToastInput) => void;
  /** "Couldn't save. Your entry is still here." · Retry. role="alert", stays until dismissed. */
  error: (toast: ToastInput) => void;
  dismiss: () => void;
};

const ToastContext = createContext<AlphaToaster | null>(null);

export function useAlphaToast(): AlphaToaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error("useAlphaToast must be used inside <AlphaRoot>");
  return toaster;
}

/**
 * One toast at a time; a new one replaces the current one. The success timer
 * pauses while the pointer or focus is on the toast, so its action stays
 * reachable. Placed 12 px above the tab bar on the phone, bottom-right on a
 * laptop.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);
  const show = useCallback((tone: Toast["tone"], input: ToastInput) => {
    nextId.current += 1;
    setToast({ ...input, tone, id: nextId.current });
  }, []);
  const toaster = useMemo<AlphaToaster>(
    () => ({
      success: (input) => show("success", input),
      error: (input) => show("error", input),
      dismiss: () => setToast(null),
    }),
    [show],
  );

  return (
    <ToastContext value={toaster}>
      {children}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-3 z-[90] flex flex-col items-stretch",
          "bottom-[calc(54px+env(safe-area-inset-bottom)+12px)]",
          "laptop:inset-x-auto laptop:right-6 laptop:bottom-6 laptop:w-[380px]",
        )}
      >
        {/* The polite live region stays mounted so each success is announced;
            the card itself carries role="status" (success) or "alert" (error). */}
        <div aria-live="polite" className="contents">
          {toast?.tone === "success" ? <ToastCard key={toast.id} toast={toast} onDismiss={toaster.dismiss} /> : null}
        </div>
        {toast?.tone === "error" ? <ToastCard key={toast.id} toast={toast} onDismiss={toaster.dismiss} /> : null}
      </div>
    </ToastContext>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  const success = toast.tone === "success";

  useEffect(() => {
    if (!success || held) return;
    const timer = setTimeout(onDismiss, TOAST_SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [success, held, onDismiss]);

  return (
    <div
      role={success ? "status" : "alert"}
      data-tone={toast.tone}
      data-slot="toast"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      className={cn(
        "pointer-events-auto flex min-h-[60px] items-center gap-2.5 rounded-[16px] bg-ink py-2 pr-2 pl-3.5 text-surface",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-reduce:animate-in motion-reduce:fade-in",
      )}
    >
      {success ? (
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-on-ink-done text-ink" aria-hidden>
          <Check className="size-[13px]" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-on-ink-missed text-[14px] font-bold text-ink"
          aria-hidden
        >
          !
        </span>
      )}
      <span className="flex-1 py-1.5 text-[14px] leading-[1.35]">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="h-11 shrink-0 rounded-[12px] px-3 text-[15px] font-semibold text-on-ink-signal-ink"
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      {success ? null : (
        <button
          type="button"
          aria-label="Dismiss"
          className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-on-ink-2"
          onClick={onDismiss}
        >
          <X className="size-[18px]" aria-hidden />
        </button>
      )}
    </div>
  );
}
