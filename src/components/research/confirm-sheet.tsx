"use client";

import { useEffect, useState } from "react";
import { Modal, ModalClose } from "@/components/app-shell/modal";
import {
  confirmFormError,
  daysBetween,
  effectText,
  lateNote,
  SITES,
  sheetUnitsLabel,
  TIME_NOW_NOTE,
  VIAL_NOTE,
  type Wall,
  wallLabel,
  wallOf,
  wallShort,
} from "@/lib/doses/rules";
import type { DoseDetail } from "@/lib/doses/today";

/** What the sheet submits (the server action adds nothing the screen didn't show). */
export type SheetSubmission = {
  amount: string;
  /** null: now, on the server's clock. */
  actual: Wall | null;
  site: string;
  notes: string;
};

type Props = {
  detail: DoseDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** Set by the page after a refused save (e.g. the dose changed since it was shown). */
  error: string | null;
  notice: string | null;
  onSubmit: (submission: SheetSubmission) => void;
};

/** The wall-clock time now in `timeZone`, refreshed every 20 seconds while mounted. */
function useWallNow(timeZone: string): Wall {
  const [now, setNow] = useState(() => wallOf(new Date(), timeZone));
  useEffect(() => {
    const timer = setInterval(() => setNow(wallOf(new Date(), timeZone)), 20_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return now;
}

/**
 * R5 Confirm sheet (a bottom sheet on phones): the amount taken (the planned
 * dose by default, with its syringe units), when it was actually taken (now,
 * or an earlier time; never a future one), and optionally the injection site
 * and observations. A dose already recorded shows what was recorded instead.
 */
export function ConfirmSheet(props: Props) {
  const { detail, open, onOpenChange } = props;
  return (
    <Modal open={open && detail !== null} onOpenChange={onOpenChange} label="Confirm administration">
      {detail ? <SheetBody key={`${detail.key}/${detail.scheduledAt}/${detail.doseMg}`} {...props} detail={detail} /> : null}
    </Modal>
  );
}

function SheetBody({ detail, pending, error: refused, notice, onSubmit }: Props & { detail: DoseDetail }) {
  const now = useWallNow(detail.timeZone);
  const [amount, setAmountValue] = useState(detail.doseMg);
  const [actual, setActualValue] = useState<Wall | null>(null);
  const [site, setSiteValue] = useState("");
  const [notes, setNotesValue] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A check's message goes once the entry changes; the next submit re-checks.
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setError(null);
      set(value);
    };
  const [setAmount, setActual, setSite, setNotes] = [edited(setAmountValue), edited(setActualValue), edited(setSiteValue), edited(setNotesValue)];

  if (detail.recorded) {
    return (
      <div className="app-dose-sheet">
        <div className="app-dose-sheet-state" data-state="taken">
          Already confirmed
        </div>
        <h2 className="app-dose-sheet-title">{detail.peptideName}</h2>
        <p className="app-dose-sheet-already">
          This dose was recorded as taken at <b>{detail.recorded.actual}</b> (entered {detail.recorded.entered}). Nothing more to do; no
          duplicate was created.
        </p>
        <ModalClose className="app-btn app-btn--secondary app-btn--block app-dose-sheet-close">Close</ModalClose>
      </div>
    );
  }

  const time = actual ?? now;
  const late = daysBetween(time.slice(0, 10), now.slice(0, 10));
  const shown = error ?? refused;
  const submit = () => {
    const submission = { amount, actual, site, notes };
    const problem = confirmFormError(submission, now);
    setError(problem);
    if (!problem) onSubmit(submission);
  };

  return (
    <div className="app-dose-sheet">
      <div className="app-dose-sheet-top">
        <span className="app-dose-sheet-state" data-state={detail.state}>
          {detail.stateLabel}
        </span>
        <ModalClose className="app-dose-sheet-cancel">Cancel</ModalClose>
      </div>
      <h2 className="app-dose-sheet-title">{detail.peptideName}</h2>
      <div className="app-dose-sheet-planned">
        Planned {detail.plannedLabel} · {detail.cycleName}
      </div>
      {notice ? <p className="app-dose-sheet-changed">{notice}</p> : null}

      <div className="app-dose-sheet-fields">
        <div className="app-dose-card">
          <label htmlFor="dose-amount" className="app-dose-card-label">
            Amount taken (mg) · planned {detail.doseMg} mg
          </label>
          <div className="app-dose-amount-row">
            <input
              id="dose-amount"
              inputMode="decimal"
              className="app-dose-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span className="app-dose-units" data-testid="sheet-units">
              {sheetUnitsLabel(detail.setup, amount)}
            </span>
          </div>
        </div>

        <div className="app-dose-card app-dose-card--time">
          <label htmlFor="dose-time" className="app-dose-card-label">
            When you actually took it
          </label>
          <input
            id="dose-time"
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
            <button
              type="button"
              className="app-dose-chip"
              aria-pressed={actual === detail.planned}
              onClick={() => setActual(detail.planned)}
            >
              Planned · {wallShort(detail.planned)}
            </button>
          </div>
          <p className="app-dose-time-note">{late > 0 ? lateNote(late) : TIME_NOW_NOTE}</p>
        </div>

        {more ? (
          <div className="app-dose-card app-dose-more">
            <div>
              <div className="app-dose-card-label" id="dose-site-label">
                Injection site · optional
              </div>
              <div className="app-dose-sites" role="group" aria-labelledby="dose-site-label">
                {SITES.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="app-dose-chip app-dose-site"
                    aria-pressed={site === label}
                    onClick={() => setSite(site === label ? "" : label)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="app-field">
              <span className="app-dose-card-label">Observations · optional</span>
              <textarea rows={2} placeholder="Anything you noticed" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
        ) : (
          <button type="button" className="app-dose-card app-dose-more-toggle" onClick={() => setMore(true)}>
            <span>
              Site and notes <span className="app-dose-optional">optional</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>

      {shown ? (
        <p role="alert" className="app-inline-error app-dose-sheet-error">
          {shown}
        </p>
      ) : null}
      <p className="app-dose-effect">{effectText(detail.effect, detail.peptideName, time, now)}</p>
      {detail.vialLabel ? <p className="app-dose-vial">{VIAL_NOTE(detail.vialLabel)}</p> : null}
      <button type="button" className="app-dose-taken app-dose-taken--sheet" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Mark Taken"}
      </button>
    </div>
  );
}

/** `Fri Sep 11 · 20:13`: an instant in the dose's zone (the "Taken · …" toast). */
export const takenWhen = (actualAt: string, timeZone: string) => wallLabel(wallOf(actualAt, timeZone));
