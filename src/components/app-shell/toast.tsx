"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "warn" | "error";
type ToastState = { id: number; message: string; tone: ToastTone };
type ShowToast = (message: string, tone?: ToastTone) => void;

export const TOAST_DURATION_MS = 3600;

/** Handoff copy for any failed save; the form keeps the person's input. */
export const SAVE_FAILED_MESSAGE =
  "Could not save. Nothing was lost — your entry is still here. Try again.";

const ToastContext = createContext<ShowToast | null>(null);

/** Shows one toast at a time (a new one replaces the current one). */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside the app shell");
  return show;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((message, tone = "info") => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setToast({ id: nextId.current, message, tone });
    timer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext value={show}>
      {children}
      {/* The live region stays mounted so screen readers announce each toast. */}
      <div className="app-root" data-legacy-host="">
        <div className="app-toast-region" role="status" aria-live="polite">
          {toast ? (
            <div key={toast.id} className="app-toast" data-tone={toast.tone}>
              {toast.message}
            </div>
          ) : null}
        </div>
      </div>
    </ToastContext>
  );
}
