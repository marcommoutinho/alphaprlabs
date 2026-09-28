import Link from "@/components/alpha/link";
import type { LinkablePlan } from "@/lib/mixtures/plans";
import { type Mixture, mixtureDetail, mixtureLabel, NO_MIXTURES } from "@/lib/mixtures/rules";

/** R7 "Saved mixtures": each with its concentration, spacing and use, Load and Delete. */
export function SavedMixtures({
  mixtures,
  plans,
  trackedVials,
  nameOf,
  busy,
  onLoad,
  onDelete,
}: {
  mixtures: Mixture[];
  plans: LinkablePlan[];
  trackedVials: Record<string, string>;
  nameOf: (peptideId: string) => string;
  busy: boolean;
  onLoad: (mixture: Mixture) => void;
  onDelete: (mixture: Mixture) => void;
}) {
  return (
    <section className="app-calc-saved" aria-labelledby="saved-mixtures">
      <div className="app-calc-saved-head">
        <h2 id="saved-mixtures">Saved mixtures</h2>
        <Link href="/app/supplies">Personal supplies ›</Link>
      </div>
      {mixtures.length === 0 ? <p className="app-calc-none">{NO_MIXTURES}</p> : null}
      {mixtures.map((mixture) => {
        const usedBy = plans.filter((plan) => plan.mixtureId === mixture.id).map((plan) => plan.cycleName);
        return (
          <div key={mixture.id} className="app-calc-row" data-testid="saved-mixture">
            <div className="app-calc-row-text">
              <b>{mixtureLabel(nameOf(mixture.peptideId), mixture.setup)}</b>
              <div className="app-calc-row-sub">{mixtureDetail(mixture.setup, usedBy, trackedVials[mixture.id])}</div>
            </div>
            <div className="app-calc-row-actions">
              <button type="button" className="app-calc-link" onClick={() => onLoad(mixture)}>
                Load
              </button>
              <button type="button" className="app-calc-link app-calc-link--quiet" disabled={busy} onClick={() => onDelete(mixture)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
