"use client";

import Link from "next/link";
import { useState } from "react";
import { reopenVialAction, setTrackingAction } from "@/app/(private)/app/supplies/actions";
import { useSubmit } from "@/components/app-shell/use-submit";
import { NEVER_ADDS, NO_VIALS, SUPPLIES_INTRO, TRACKING_OFF } from "@/lib/supplies/rules";
import type { SuppliesView, VialCard } from "@/lib/supplies/view";
import { AddVialForm, EditVialModal, FinishVialModal } from "./supplies-forms";

/**
 * R8 Personal supplies (the prototype's supplies screen): "Track supplies",
 * the researcher's vials grouped by peptide (open ones first, then finished)
 * with each one's estimated remaining, low-stock outlook and history, and
 * "Add a vial". Optional: while tracking is off only the note shows.
 */
export function SuppliesScreen({ view }: { view: SuppliesView }) {
  const tracking = useSubmit(setTrackingAction);
  const [target, setTarget] = useState(view.tracking);
  const [editing, setEditing] = useState<VialCard | null>(null);
  const [finishing, setFinishing] = useState<VialCard | null>(null);
  const on = tracking.pending ? target : view.tracking;

  const toggle = (next: boolean) => {
    setTarget(next);
    tracking.submit({ enabled: next });
  };

  return (
    <>
      <div className="app-sup-head">
        <div>
          <h1 className="app-h1">Personal supplies</h1>
          <p className="app-subtitle">{SUPPLIES_INTRO}</p>
        </div>
        <label className="app-sup-toggle">
          <input type="checkbox" checked={on} disabled={tracking.pending} onChange={(event) => toggle(event.target.checked)} />
          Track supplies
        </label>
      </div>

      {!view.tracking ? (
        <div className="app-sup-note" data-testid="supplies-off">
          {TRACKING_OFF}
        </div>
      ) : (
        <>
          {!view.hasVials ? <div className="app-sup-note">{NO_VIALS}</div> : null}
          {view.groups.map((group) => (
            <section key={group.peptideId} className="app-sup-group" aria-labelledby={`sup-${group.peptideId}`}>
              <h2 id={`sup-${group.peptideId}`} className="app-sup-group-title">
                {group.name}
              </h2>
              <div className="app-sup-cards">
                {group.vials.map((vial) => (
                  <VialCardView key={vial.id} vial={vial} onEdit={() => setEditing(vial)} onFinish={() => setFinishing(vial)} />
                ))}
              </div>
            </section>
          ))}
          <AddVialForm key={view.labels.length} view={view} />
          <p className="app-sup-footnote">{NEVER_ADDS}</p>
        </>
      )}

      <EditVialModal vial={editing} view={view} onClose={() => setEditing(null)} />
      <FinishVialModal vial={finishing} onClose={() => setFinishing(null)} />
    </>
  );
}

function VialCardView({ vial, onEdit, onFinish }: { vial: VialCard; onEdit: () => void; onFinish: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const reopen = useSubmit(reopenVialAction);
  return (
    <section className="app-sup-card" data-testid="vial-card" data-open={vial.open} data-tone={vial.tone} aria-label={`Vial ${vial.label}`}>
      <div className="app-sup-card-top">
        <b className="app-sup-card-title">
          {vial.label}{" "}
          <span className="app-sup-card-meta">
            · {vial.peptideName} · {vial.strengthMg} mg vial
          </span>
        </b>
        <span className="app-sup-state" data-tone={vial.tone} data-testid="vial-state">
          {vial.state}
        </span>
      </div>
      <div className="app-sup-bar" aria-hidden="true">
        <div className="app-sup-bar-fill" data-tone={vial.tone} style={{ width: `${vial.percent.toFixed(1)}%` }} />
      </div>
      <div className="app-sup-numbers">
        <span>
          Estimated remaining{" "}
          <b className="app-sup-remaining" data-testid="vial-remaining">
            {vial.remaining}
          </b>
        </span>
        <span data-testid="vial-uses">{vial.uses}</span>
      </div>
      <div className="app-sup-line">{vial.finished ? `${vial.finished} · ${vial.mixLine}` : vial.mixLine}</div>
      {vial.outlook ? (
        <div className="app-sup-outlook" data-tone={vial.tone} data-testid="vial-outlook">
          {vial.outlook}
        </div>
      ) : null}

      <div className="app-sup-actions">
        {vial.history.length ? (
          <button type="button" className="app-sup-link" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide history" : `History (${vial.history.length})`}
          </button>
        ) : null}
        {vial.open ? (
          <>
            <button type="button" className="app-sup-link" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="app-sup-link app-sup-link--quiet" onClick={onFinish}>
              Finish
            </button>
          </>
        ) : (
          <button
            type="button"
            className="app-sup-link"
            disabled={reopen.pending}
            onClick={() => reopen.submit({ id: vial.id, label: vial.label })}
          >
            {reopen.pending ? "Saving…" : "Reopen"}
          </button>
        )}
      </div>

      {showHistory ? (
        <ol className="app-sup-history" aria-label={`History of vial ${vial.label}`}>
          {vial.history.map((entry) => (
            <li key={entry.id} className="app-sup-history-row" data-testid="vial-history-row" data-discrepancy={entry.discrepancy}>
              <span className="app-sup-history-when">
                {entry.when || "Dose not readable"}
                {entry.cycleName ? <span className="app-sup-history-cycle"> · {entry.cycleName}</span> : null}
              </span>
              <span className="app-sup-history-amount">−{entry.amount}</span>
              <span className="app-sup-history-after">
                {entry.after}
                {entry.discrepancy ? <span className="app-sup-history-flag"> · past the vial&apos;s contents</span> : null}
              </span>
              {entry.href ? (
                <Link href={entry.href} className="app-sup-history-link">
                  View dose
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
