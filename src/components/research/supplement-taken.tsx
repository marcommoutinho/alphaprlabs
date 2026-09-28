"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { takeSupplementAction, type TakenActionResult } from "@/app/(private)/app/supplements/actions";
import { Modal, ModalClose } from "@/components/app-shell/modal";
import { SAVE_FAILED_MESSAGE, type ToastTone, useToast } from "@/components/app-shell/toast";
import { daysBetween, lateNote, TIME_NOW_NOTE, type Wall, wallLabel, wallOf, wallShort } from "@/lib/doses/rules";
import { takenTimeError, takenToast } from "@/lib/supplements/rules";
import type { SupplementDetail } from "@/lib/supplements/view";

/**
 * "Taken" for supplement occurrences (Today and R10): one request key per
 * occurrence for the page's life, so a retry or a double tap sends the same
 * key and the server records one Taken and returns it again. `actual` is a
 * wall-clock time in the routine's zone, or null for now.
 */
/** Where the hook reports (Today passes the v3 toasts; R10 keeps the legacy ones). */
export type SupplementNotify = (message: string, tone: ToastTone) => void;

export function useTakeSupplement(notify?: SupplementNotify) {
  const legacy = useToast();
  const toast = notify ?? legacy;
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

/** The wall-clock time now in `timeZone`, refreshed every 20 seconds while mounted. */
function useWallNow(timeZone: string): Wall {
  const [now, setNow] = useState(() => wallOf(new Date(), timeZone));
  useEffect(() => {
    const timer = setInterval(() => setNow(wallOf(new Date(), timeZone)), 20_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return now;
}

type SheetProps = {
  detail: SupplementDetail | null;
  onClose: () => void;
  pending: boolean;
  onSubmit: (detail: SupplementDetail, actual: Wall | null, onError: (message: string) => void) => void;
};

/** "Taken at another time": when it was actually taken (now, or earlier; never later). */
export function SupplementTimeSheet({ detail, onClose, pending, onSubmit }: SheetProps) {
  return (
    <Modal open={detail !== null} onOpenChange={(open) => (open ? null : onClose())} label="Record a supplement">
      {detail ? <SheetBody key={`${detail.key}/${detail.scheduledAt}/${detail.amount}/${detail.unit}`} detail={detail} pending={pending} onSubmit={onSubmit} /> : null}
    </Modal>
  );
}

function SheetBody({ detail, pending, onSubmit }: { detail: SupplementDetail; pending: boolean; onSubmit: SheetProps["onSubmit"] }) {
  const now = useWallNow(detail.timeZone);
  const [actual, setActualValue] = useState<Wall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setActual = (value: Wall | null) => {
    setError(null);
    setActualValue(value);
  };
  const time = actual ?? now;
  const late = daysBetween(time.slice(0, 10), now.slice(0, 10));
  const submit = () => {
    const problem = takenTimeError(actual, now);
    setError(problem);
    if (!problem) onSubmit(detail, actual, setError);
  };

  return (
    <div className="app-dose-sheet">
      <div className="app-dose-sheet-top">
        <span className="app-dose-sheet-state">Supplement</span>
        <ModalClose className="app-dose-sheet-cancel">Cancel</ModalClose>
      </div>
      <h2 className="app-dose-sheet-title">{detail.name}</h2>
      <div className="app-dose-sheet-planned">Planned {detail.plannedLabel}</div>
      <div className="app-dose-sheet-fields">
        <div className="app-dose-card app-dose-card--time">
          <label htmlFor="supplement-time" className="app-dose-card-label">
            When you actually took it
          </label>
          <input
            id="supplement-time"
            type="datetime-local"
            className="app-dose-time"
            value={time}
            max={now}
            onChange={(event) => setActual(event.target.value)}
          />
          <div className="app-dose-chips">
            <button type="button" className="app-dose-chip" aria-pressed={actual === null} onClick={() => setActual(null)}>
              Now · {wallShort(now)}
            </button>
            <button type="button" className="app-dose-chip" aria-pressed={actual === detail.planned} onClick={() => setActual(detail.planned)}>
              Planned · {wallShort(detail.planned)}
            </button>
          </div>
          <p className="app-dose-time-note">{late > 0 ? lateNote(late) : TIME_NOW_NOTE}</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="app-inline-error app-dose-sheet-error">
          {error}
        </p>
      ) : null}
      <button type="button" className="app-dose-taken app-dose-taken--sheet" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Mark Taken"}
      </button>
    </div>
  );
}
