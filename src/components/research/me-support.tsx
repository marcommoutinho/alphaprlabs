"use client";

import { useState } from "react";
import { grantSupportAction, revokeSupportAction } from "@/app/(private)/app/me/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSignOut } from "@/components/app-shell/use-sign-out";
import { useSubmit } from "@/components/app-shell/use-submit";
import { type ActiveGrant, CHOOSE_ADMIN, GRANT_POINTS, type MeSupport, NO_ADMINS, REVOKE_POINTS } from "@/lib/support/view";

/**
 * R11 "Support access" (the prototype's): each admin who can read the
 * researcher's history now, with Revoke behind a confirm step; granting an
 * admin read-only access, also behind a confirm step; and the past grants.
 * With one admin to choose the button names them, as designed; with several
 * the researcher picks one first.
 */
export function MeSupportSection({ support }: { support: MeSupport }) {
  const grant = useSubmit(grantSupportAction);
  const [chosen, setChosen] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const only = support.grantable.length === 1 ? support.grantable[0] : null;
  const pick = only?.id ?? chosen;
  const target = support.grantable.find((admin) => admin.id === deciding) ?? null;

  const start = () => {
    if (!pick) {
      grant.setError(CHOOSE_ADMIN);
      return;
    }
    grant.setError(undefined);
    setDeciding(pick);
  };

  return (
    <>
      {support.active.map((active) => (
        <ActiveGrantCard key={active.adminId} grant={active} />
      ))}

      {target ? (
        <div className="app-me-confirm" role="group" aria-label={`Grant ${target.name} access?`}>
          <b className="app-me-confirm-title">Grant {target.name} access?</b>
          <ul className="app-me-points">
            {GRANT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="app-me-confirm-actions">
            <AppButton
              size="md"
              saving={grant.pending}
              onClick={() => grant.submit({ adminId: target.id }, (result) => result?.done && setDeciding(null))}
            >
              Grant read-only access
            </AppButton>
            <AppButton variant="secondary" disabled={grant.pending} onClick={() => setDeciding(null)}>
              Cancel
            </AppButton>
          </div>
          <InlineError>{grant.error}</InlineError>
        </div>
      ) : support.grantable.length === 0 ? (
        support.active.length === 0 ? <p className="app-me-note">{NO_ADMINS}</p> : null
      ) : (
        <div className="app-me-grant">
          {only ? null : (
            <Field label="Admin" className="app-me-admin-field">
              <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
                <option value="">Choose an admin</option>
                {support.grantable.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <AppButton variant="secondary" className="app-me-grant-btn" onClick={start}>
            {only ? `Grant ${only.name} read-only access` : "Grant read-only access"}
          </AppButton>
          <InlineError>{grant.error}</InlineError>
        </div>
      )}

      {support.past ? (
        <div className="app-me-past" data-testid="support-past">
          {support.past}
        </div>
      ) : null}
    </>
  );
}

/** An admin who can read the history now, with Revoke behind a confirm step. */
function ActiveGrantCard({ grant }: { grant: ActiveGrant }) {
  const revoke = useSubmit(revokeSupportAction);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="app-me-active" data-testid="support-active" aria-label={`${grant.adminName} has read-only access`} role="group">
      <div className="app-me-active-row">
        <div>
          <b className="app-me-active-name">{grant.adminName}</b> <span className="app-me-active-tag">has read-only access</span>
          <div className="app-me-active-since">{grant.since}</div>
          {grant.note ? <div className="app-me-active-note">{grant.note}</div> : null}
        </div>
        {confirming ? null : (
          <button type="button" className="app-me-revoke" onClick={() => setConfirming(true)}>
            Revoke access
          </button>
        )}
      </div>
      {confirming ? (
        <div className="app-me-revoke-confirm">
          <b className="app-me-confirm-title">Revoke {grant.adminName}&apos;s access?</b>
          <ul className="app-me-points">
            {REVOKE_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="app-me-confirm-actions">
            <button
              type="button"
              className="app-me-revoke app-me-revoke--confirm"
              disabled={revoke.pending}
              aria-busy={revoke.pending || undefined}
              onClick={() => revoke.submit({ adminId: grant.adminId }, (result) => result?.done && setConfirming(false))}
            >
              {revoke.pending ? "Saving…" : "Revoke access"}
            </button>
            <AppButton variant="secondary" size="sm" disabled={revoke.pending} onClick={() => setConfirming(false)}>
              Cancel
            </AppButton>
          </div>
          <InlineError>{revoke.error}</InlineError>
        </div>
      ) : null}
    </div>
  );
}

/** R11's Sign out (the same as the account menu's). */
export function MeSignOut() {
  const { pending, signOut } = useSignOut();
  return (
    <button type="button" className="app-me-signout" disabled={pending} onClick={signOut}>
      Sign out
    </button>
  );
}
