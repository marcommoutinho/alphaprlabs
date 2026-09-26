"use client";

import { useState } from "react";
import type { HistoryRow } from "@/lib/cycles/views";

/** Rows shown before "Show all N records" (the prototype's). */
const FIRST = 8;

/**
 * R4 "Scheduled vs actual": planned, actual and entered times kept apart,
 * newest first. Confirming from a row arrives with S12.
 */
export function CycleHistory({ rows }: { rows: HistoryRow[] }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="app-empty app-cv-history-empty">No doses due yet.</p>;
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <div className="app-cv-history-rows">
      {shown.map((row) => (
        <div key={row.key} className="app-cv-history-row" data-testid="history-row">
          <span>
            <span className="app-cv-history-label">Planned</span>
            {row.planned}
          </span>
          <span>
            {row.peptide} <span className="app-cv-history-mg">· {row.mg}</span>
          </span>
          <span>
            <span className="app-cv-history-label">Actual</span>
            {row.actual}
          </span>
          <span>
            <span className="app-cv-history-label">Entered</span>
            <span className="app-cv-history-entered">{row.entered}</span>
          </span>
          <span className="app-cv-history-state" data-state={row.state}>
            {row.stateLabel}
          </span>
        </div>
      ))}
      {rows.length > FIRST ? (
        <button type="button" className="app-cv-history-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length} records`}
        </button>
      ) : null}
    </div>
  );
}
