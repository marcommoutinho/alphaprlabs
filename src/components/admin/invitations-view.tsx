"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { resendInvitationAction, sendInvitation } from "@/app/(private)/admin/invitations/actions";
import { AppButton, EmptyState, Field, InlineError } from "@/components/app-shell/form";
import { SAVE_FAILED_MESSAGE, useToast } from "@/components/app-shell/toast";
import { useSubmit } from "@/components/app-shell/use-submit";
import {
  ADMIN_CONFIRM_POINTS,
  ADMIN_CONFIRM_SUBMIT,
  ADMIN_CONFIRM_TITLE,
  ROLE_LABEL,
  type InvitationDisplayState,
  type InvitationRole,
} from "@/lib/invitations/state";
import "@/styles/app/invitations.css";

export type InvitationListRow = {
  id: string;
  name: string;
  email: string;
  sent: string;
  state: InvitationDisplayState;
  label: string;
  canResend: boolean;
  role: InvitationRole;
};

const ROLES: readonly InvitationRole[] = ["researcher", "admin"];

/**
 * A1: "Invite a researcher" card and the invitation list (newest first).
 * Access is Researcher (default) or Admin (Marco, 2026-09-27); sending an
 * admin invitation asks for confirmation first.
 */
export function InvitationsView({ rows }: { rows: InvitationListRow[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("researcher");
  const [confirming, setConfirming] = useState(false);
  const { pending, error, submit } = useSubmit(sendInvitation);

  function send() {
    submit({ name, email, role }, (result) => {
      setConfirming(false);
      if (result.sent) {
        setName("");
        setEmail("");
        setRole("researcher");
      }
    });
  }

  return (
    <div className="app-invites">
      <section className="app-card app-invite-form" aria-labelledby="invite-title">
        <h2 id="invite-title" className="app-card-title">
          Invite a researcher
        </h2>
        <form
          noValidate
          className="app-invite-fields"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            if (role === "admin") setConfirming(true);
            else send();
          }}
        >
          <Field label="Name">
            <input name="name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </Field>
          <div role="group" aria-labelledby="invite-role-label">
            <span id="invite-role-label" className="app-field-label">
              Access
            </span>
            <div className="app-invite-toggle">
              {ROLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={role === option}
                  disabled={confirming}
                  onClick={() => setRole(option)}
                >
                  {ROLE_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <InlineError>{error}</InlineError>
          {confirming ? (
            <div className="app-invite-confirm" role="group" aria-label={ADMIN_CONFIRM_TITLE}>
              <b className="app-invite-confirm-title">{ADMIN_CONFIRM_TITLE}</b>
              <ul className="app-invite-points">
                {ADMIN_CONFIRM_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className="app-invite-confirm-actions">
                <AppButton saving={pending} savingLabel="Sending…" onClick={send}>
                  {ADMIN_CONFIRM_SUBMIT}
                </AppButton>
                <AppButton variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </AppButton>
              </div>
            </div>
          ) : (
            <AppButton type="submit" saving={pending} savingLabel="Sending…">
              Send invitation
            </AppButton>
          )}
        </form>
        <p className="app-invite-note">
          Valid for 30 days. Promotion, suspension and other account tools are not part of this MVP.
        </p>
      </section>
      <div>
        {rows.length === 0 ? <EmptyState>No invitations yet.</EmptyState> : null}
        {rows.map((row) => (
          <InvitationRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function InvitationRow({ row }: { row: InvitationListRow }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function resend() {
    startTransition(async () => {
      try {
        const result = await resendInvitationAction(row.id);
        if (result.toast) toast(result.toast, result.tone);
      } catch (error) {
        // An expired admin session redirects to sign-in: not a failed save.
        unstable_rethrow(error);
        toast(SAVE_FAILED_MESSAGE, "error");
      }
    });
  }

  return (
    <div className="app-invite-row" data-testid="invitation-row">
      <div className="app-invite-who">
        <b>{row.name}</b> <span className="app-invite-email">· {row.email}</span>
        <div className="app-invite-sent">
          <span className="app-invite-role" data-role={row.role}>
            {ROLE_LABEL[row.role]}
          </span>{" "}
          · Sent {row.sent}
        </div>
      </div>
      <div className="app-invite-status">
        <span className="app-invite-state" data-state={row.state}>
          {row.label}
        </span>
        {row.canResend ? (
          <button type="button" className="app-invite-resend" onClick={resend} disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Sending…" : "Resend"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
