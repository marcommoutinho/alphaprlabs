"use client";

import { useState } from "react";
import { setSupplementTrackingAction } from "@/app/(private)/app/supplements/actions";
import { useSubmit } from "@/components/app-shell/use-submit";
import { GUIDANCE_NOTE, NO_GUIDANCE, NO_ROUTINES, REMINDERS_LATER, SUPPLEMENTS_INTRO, TRACKING_OFF } from "@/lib/supplements/rules";
import type { RoutineCard, SupplementDetail, SupplementsView } from "@/lib/supplements/view";
import { SupplementTimeSheet, useTakeSupplement } from "./supplement-taken";
import { EditRoutineModal, EndRoutineModal, NewRoutineForm } from "./supplements-forms";

/**
 * R10 Supplement routines (the prototype's screen): the supplement guidance
 * admins supplied, "Track supplements", and — while tracking is on — each
 * routine (name · amount unit · daily time) with its state today, "Taken
 * today", its Taken history, Edit and End, then "New routine". Supplements use
 * their own units and never touch peptide mixtures, vials or stock.
 */
export function SupplementsScreen({ view }: { view: SupplementsView }) {
  const tracking = useSubmit(setSupplementTrackingAction);
  const [target, setTarget] = useState(view.tracking);
  const [editing, setEditing] = useState<RoutineCard | null>(null);
  const [ending, setEnding] = useState<RoutineCard | null>(null);
  const [otherTime, setOtherTime] = useState<SupplementDetail | null>(null);
  const take = useTakeSupplement();
  const on = tracking.pending ? target : view.tracking;

  const toggle = (next: boolean) => {
    setTarget(next);
    tracking.submit({ enabled: next });
  };

  return (
    <>
      <div className="app-supp-head">
        <div>
          <h1 className="app-h1">Supplement routines</h1>
          <p className="app-subtitle">{SUPPLEMENTS_INTRO}</p>
        </div>
        <label className="app-supp-toggle">
          <input type="checkbox" checked={on} disabled={tracking.pending} onChange={(event) => toggle(event.target.checked)} />
          Track supplements
        </label>
      </div>

      <section className="app-supp-guidance" aria-labelledby="supp-guidance" data-testid="supplement-guidance">
        <div id="supp-guidance" className="app-supp-guidance-label">
          GUIDANCE · SUPPLIED BY ADMINS
        </div>
        {view.guidance.length ? (
          view.guidance.map((entry) => (
            <p key={entry.name} className="app-supp-guidance-text">
              <b>{entry.name}:</b> {entry.text}
            </p>
          ))
        ) : (
          <p className="app-supp-guidance-text">{NO_GUIDANCE}</p>
        )}
        <p className="app-supp-guidance-note">{GUIDANCE_NOTE}</p>
      </section>

      {!view.tracking ? (
        <p className="app-supp-note" data-testid="supplements-off">
          {TRACKING_OFF}
        </p>
      ) : (
        <>
          {view.empty ? <p className="app-supp-note">{NO_ROUTINES}</p> : null}
          {view.routines.length ? (
            <div className="app-supp-cards">
              {view.routines.map((routine) => (
                <RoutineCardView
                  key={routine.id}
                  routine={routine}
                  busy={routine.today !== null && take.busy(routine.today.key)}
                  disabled={take.pending}
                  onTake={(detail) => take.take(detail, null)}
                  onOtherTime={setOtherTime}
                  onEdit={() => setEditing(routine)}
                  onEnd={() => setEnding(routine)}
                />
              ))}
            </div>
          ) : null}
          <NewRoutineForm />
          <p className="app-supp-footnote">{REMINDERS_LATER}</p>
        </>
      )}

      <EditRoutineModal routine={editing} onClose={() => setEditing(null)} />
      <EndRoutineModal routine={ending} onClose={() => setEnding(null)} />
      <SupplementTimeSheet
        detail={otherTime}
        onClose={() => setOtherTime(null)}
        pending={take.pending}
        onSubmit={(detail, actual, onError) => take.take(detail, actual, { onDone: () => setOtherTime(null), onError })}
      />
    </>
  );
}

type CardProps = {
  routine: RoutineCard;
  busy: boolean;
  disabled: boolean;
  onTake: (detail: SupplementDetail) => void;
  onOtherTime: (detail: SupplementDetail) => void;
  onEdit: () => void;
  onEnd: () => void;
};

function RoutineCardView({ routine, busy, disabled, onTake, onOtherTime, onEdit, onEnd }: CardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const { today } = routine;
  return (
    <section className="app-supp-card" data-testid="routine-card" data-ended={routine.ended} aria-label={`Routine ${routine.name}`}>
      <div className="app-supp-card-top">
        <b className="app-supp-card-title" data-testid="routine-title">
          {routine.name}{" "}
          <span className="app-supp-card-meta">
            · {routine.amount} {routine.unit} · daily {routine.time}
          </span>
        </b>
        <span className="app-supp-state" data-tone={routine.tone} data-testid="routine-state">
          {routine.state}
        </span>
      </div>
      <div className="app-supp-card-bottom">
        <span data-testid="routine-recent">
          {routine.since} · {routine.recent}
        </span>
        <div className="app-supp-actions">
          {today ? (
            <>
              <button type="button" className="app-supp-take" disabled={disabled} onClick={() => onTake(today)}>
                {busy ? "Saving…" : "Taken today"}
              </button>
              <button type="button" className="app-supp-link app-supp-link--quiet" disabled={disabled} onClick={() => onOtherTime(today)}>
                Other time
              </button>
            </>
          ) : null}
          {routine.history.length ? (
            <button type="button" className="app-supp-link" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? "Hide history" : `History (${routine.history.length})`}
            </button>
          ) : null}
          {!routine.ended ? (
            <>
              <button type="button" className="app-supp-link" onClick={onEdit}>
                Edit
              </button>
              <button type="button" className="app-supp-link app-supp-link--quiet" onClick={onEnd}>
                End routine
              </button>
            </>
          ) : null}
        </div>
      </div>
      {showHistory ? (
        <ol className="app-supp-history" aria-label={`History of ${routine.name}`}>
          {routine.history.map((entry) => (
            <li key={entry.id} className="app-supp-history-row" data-testid="routine-history-row">
              <span>{entry.when}</span>
              <span className="app-supp-history-amount">
                {entry.amount} <span className="app-supp-history-planned">· {entry.planned}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
