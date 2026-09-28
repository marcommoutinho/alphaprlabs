import Link from "@/components/alpha/link";
import { type AccountState, deniedText, type HistoryView, sharedLabel } from "@/lib/support/view";

/** A8's denied state: this researcher isn't sharing with the team (stopped, or never shared). */
export function ResearcherDenied({ account }: { account: AccountState }) {
  return (
    <div className="app-a8-denied" data-testid="support-denied">
      <div className="app-a8-denied-label">Access denied</div>
      <h1 className="app-a8-denied-title">{account.name} isn&apos;t sharing their history</h1>
      <p className="app-a8-denied-text">{deniedText(account)}</p>
    </div>
  );
}

/** A8's shared state: the four read-only cards (the prototype's 2×2). Nothing here writes. */
export function ResearcherHistory({ account, sharedSince, view, full }: { account: AccountState; sharedSince: string; view: HistoryView; full: boolean }) {
  return (
    <>
      <div className="app-a8-head">
        <div className="app-a8-granted">{sharedLabel(sharedSince)}</div>
        <h1 className="app-h1 app-a8-name">{account.name}</h1>
        <div className="app-a8-meta">{account.email} · full profile history · nothing here can be edited</div>
      </div>

      <div className="app-a8-cards">
        <section className="app-a8-card" aria-labelledby="a8-cycles" data-testid="history-cycles">
          <h2 id="a8-cycles">Cycles</h2>
          {view.cycles.length === 0 ? <p className="app-a8-empty">No cycles.</p> : null}
          {view.cycles.map((cycle) => (
            <div key={cycle.id} className="app-a8-item">
              <b>{cycle.name}</b> <span className="app-a8-dim">· {cycle.status}</span>
              <div className="app-a8-item-sub">
                {cycle.dates} · {cycle.peptides} · goal: {cycle.goal}
              </div>
            </div>
          ))}
        </section>

        <section className="app-a8-card" aria-labelledby="a8-doses" data-testid="history-doses">
          <h2 id="a8-doses">Recent actual administrations</h2>
          {view.doses.length === 0 ? <p className="app-a8-empty">None recorded.</p> : null}
          {view.doses.map((dose) => (
            <div key={dose.id} className="app-a8-line">
              <span>
                {dose.peptide} · {dose.mg}
              </span>
              <span className="app-a8-when">{dose.time}</span>
            </div>
          ))}
        </section>

        <section className="app-a8-card" aria-labelledby="a8-checkins" data-testid="history-checkins">
          <h2 id="a8-checkins">Check-ins &amp; measurements</h2>
          {view.checkIns.length === 0 ? <p className="app-a8-empty">No check-ins recorded.</p> : null}
          {view.checkIns.map((checkIn) => (
            <div key={checkIn.id} className="app-a8-line app-a8-line--stack">
              <div>
                <span className="app-a8-when">{checkIn.date}</span> · feeling {checkIn.feeling}/5
                {checkIn.effects ? (
                  <>
                    {" · "}
                    <span className="app-a8-effects">{checkIn.effects}</span>
                  </>
                ) : null}
              </div>
              {checkIn.note ? <div className="app-a8-note">“{checkIn.note}”</div> : null}
            </div>
          ))}
          {view.measures ? <div className="app-a8-measures">{view.measures}</div> : null}
        </section>

        <section className="app-a8-card" aria-labelledby="a8-supplies" data-testid="history-supplies">
          <h2 id="a8-supplies">Personal supplies &amp; supplements</h2>
          <p className="app-a8-para">{view.supplies}</p>
          {view.mixtures.length ? (
            <div data-testid="history-mixtures">
              <div className="app-a8-subhead">Saved mixtures</div>
              {view.mixtures.map((mixture) => (
                <div key={mixture.id} className="app-a8-mixture" data-testid="history-mixture" data-deleted={mixture.deleted || undefined}>
                  <b>{mixture.title}</b> <span className="app-a8-dim">· {mixture.state}</span>
                  <ul className="app-a8-mixture-versions">
                    {mixture.versions.map((version) => (
                      <li key={version.id}>{version.line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <p className="app-a8-para">{view.supplements}</p>
          {view.taken.map((taken) => (
            <div key={taken.id} className="app-a8-line">
              <span>Taken · {taken.line}</span>
              <span className="app-a8-when">{taken.time}</span>
            </div>
          ))}
        </section>
      </div>

      {view.cut ? (
        <p className="app-a8-more">
          Showing the most recent records ({view.counts.doses} administrations, {view.counts.checkIns} check-ins and {view.counts.taken} supplements
          taken in all). <Link href={`/admin/support/${account.id}?full=1`}>Show full history</Link>
        </p>
      ) : full ? (
        <p className="app-a8-more">
          Showing every record. <Link href={`/admin/support/${account.id}`}>Show recent only</Link>
        </p>
      ) : null}
    </>
  );
}
