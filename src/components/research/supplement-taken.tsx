"use client";

import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { takeSupplementAction, type TakenActionResult } from "@/app/(private)/app/supplements/actions";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/lib/app/save";
import { type Wall, wallLabel, wallOf } from "@/lib/doses/rules";
import { takenToast } from "@/lib/supplements/rules";
import type { SupplementDetail } from "@/lib/supplements/view";

/**
 * "Taken" for supplement occurrences (Today and R13): one request key per
 * occurrence for the page's life, so a retry or a double tap sends the same
 * key and the server records one Taken and returns it again. `actual` is a
 * wall-clock time in the routine's zone, or null for now.
 */
/** Where the hook reports (Today and R13 pass the v3 toasts). */
export type SupplementNotify = (message: string, tone: ToastTone) => void;

export function useTakeSupplement(toast: SupplementNotify) {
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const requestKeyFor = (key: string) => {
    let value = requestKeys.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      requestKeys.current.set(key, value);
    }
    return value;
  };

  /** Records it; `onError` receives an inline message (the sheet shows it), else it is toasted. */
  const take = (detail: SupplementDetail, actual: Wall | null, handlers: { onDone?: () => void; onError?: (message: string) => void } = {}) => {
    if (pending) return;
    setPendingKey(detail.key);
    startTransition(async () => {
      let result: TakenActionResult;
      try {
        result = await takeSupplementAction({
          requestKey: requestKeyFor(detail.key),
          key: detail.key,
          seenScheduledAt: detail.scheduledAt,
          seenName: detail.name,
          seenAmount: detail.amount,
          seenUnit: detail.unit,
          actual,
        });
      } catch (error) {
        // A redirect (the session ended: sign in again) goes to Next.js, not to the toast.
        unstable_rethrow(error);
        toast(SAVE_FAILED_MESSAGE, "error");
        setPendingKey(null);
        return;
      }
      setPendingKey(null);
      if (result.outcome === "taken" && result.actualAt) {
        toast(takenToast(detail.name, wallLabel(wallOf(result.actualAt, detail.timeZone))), "info");
        handlers.onDone?.();
        return;
      }
      // Taken elsewhere, changed or gone: the page refreshed and shows it as it is now.
      const settled = result.outcome === "already" || result.outcome === "changed" || result.outcome === "gone";
      if (settled) handlers.onDone?.();
      if (result.error) {
        if (handlers.onError && !settled) handlers.onError(result.error);
        else toast(result.error, "error");
      }
      if (result.toast) toast(result.toast, result.tone ?? "error");
    });
  };

  return { take, pending, busy: (key: string) => pending && pendingKey === key };
}
