"use client";

import { useState } from "react";
import { shareWithTeamAction, stopSharingAction } from "@/app/(private)/app/me/actions";
import { AppButton, InlineError } from "@/components/app-shell/form";
import { useSignOut } from "@/components/app-shell/use-sign-out";
import { useSubmit } from "@/components/app-shell/use-submit";
import { type MeSupport, SHARE_BUTTON, SHARE_POINTS, SHARE_QUESTION, STOP_POINTS, STOP_QUESTION } from "@/lib/support/view";

/**
 * R11 "Support access" (the prototype's, simplified by Marco on 2026-09-27):
 * one step shares the full history, read-only, with the Alpha PR Labs team
 * (every admin, including admins added later), behind a confirm step; while
 * shared, "Stop sharing", also behind a confirm step, ends it for every
 * admin. The past shares follow. No admin is ever named or chosen here.
 */
export function MeSupportSection({ support }: { support: MeSupport }) {
  return (
    <>
      {support.sharedSince ? <SharedCard since={support.sharedSince} /> : <ShareStep />}
      {support.past ? (
        <div className="app-me-past" data-testid="support-past">
          {support.past}
        </div>
      ) : null}
    </>
  );
}

/** Not shared: "Share with the Alpha PR Labs team", then the confirm step. */
function ShareStep() {
  const share = useSubmit(shareWithTeamAction);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="app-me-grant">
        <AppButton variant="secondary" className="app-me-grant-btn" onClick={() => setConfirming(true)}>
          {SHARE_BUTTON}
        </AppButton>
      </div>
    );
  }
  return (
    <div className="app-me-confirm" role="group" aria-label={SHARE_QUESTION}>
      <b className="app-me-confirm-title">{SHARE_QUESTION}</b>
      <ul className="app-me-points">
        {SHARE_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="app-me-confirm-actions">
        <AppButton size="md" saving={share.pending} onClick={() => share.submit(undefined, (result) => result?.done && setConfirming(false))}>
          Share read-only history
        </AppButton>
        <AppButton variant="secondary" disabled={share.pending} onClick={() => setConfirming(false)}>
          Cancel
        </AppButton>
      </div>
      <InlineError>{share.error}</InlineError>
    </div>
  );
}

/** Shared now: since when, with "Stop sharing" behind a confirm step. */
function SharedCard({ since }: { since: string }) {
  const stop = useSubmit(stopSharingAction);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="app-me-active" data-testid="support-active" aria-label="Shared with the Alpha PR Labs team" role="group">
      <div className="app-me-active-row">
        <div>
          <b className="app-me-active-name">Alpha PR Labs team</b> <span className="app-me-active-tag">can read your history</span>
          <div className="app-me-active-since">{since}</div>
        </div>
        {confirming ? null : (
          <button type="button" className="app-me-revoke" onClick={() => setConfirming(true)}>
            Stop sharing
          </button>
        )}
      </div>
      {confirming ? (
        <div className="app-me-revoke-confirm" role="group" aria-label={STOP_QUESTION}>
          <b className="app-me-confirm-title">{STOP_QUESTION}</b>
          <ul className="app-me-points">
            {STOP_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="app-me-confirm-actions">
            <button
              type="button"
              className="app-me-revoke app-me-revoke--confirm"
              disabled={stop.pending}
              aria-busy={stop.pending || undefined}
              onClick={() => stop.submit(undefined, (result) => result?.done && setConfirming(false))}
            >
              {stop.pending ? "Saving…" : "Stop sharing"}
            </button>
            <AppButton variant="secondary" size="sm" disabled={stop.pending} onClick={() => setConfirming(false)}>
              Cancel
            </AppButton>
          </div>
          <InlineError>{stop.error}</InlineError>
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
