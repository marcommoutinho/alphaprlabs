"use client";

import { useState, useTransition } from "react";
import { resendInvitationAction, sendInvitation } from "@/app/(private)/admin/invitations/actions";
import { AppButton, EmptyState, Field, InlineError } from "@/components/app-shell/form";
import { SAVE_FAILED_MESSAGE, useToast } from "@/components/app-shell/toast";
import { useSubmit } from "@/components/app-shell/use-submit";
import type { InvitationDisplayState } from "@/lib/invitations/state";
import "@/styles/app/invitations.css";

export type InvitationListRow = {
  id: string;
  name: string;
  email: string;
  sent: string;
  state: InvitationDisplayState;
  label: string;
  canResend: boolean;
};

/** A1: "Invite a researcher" card and the invitation list (newest first). */
export function InvitationsView({ rows }: { rows: InvitationListRow[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { pending, error, submit } = useSubmit(sendInvitation);

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
            submit({ name, email }, (result) => {
              if (result.sent) {
                setName("");
                setEmail("");
              }
            });
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
          <InlineError>{error}</InlineError>
          <AppButton type="submit" saving={pending} savingLabel="Sending…">
            Send invitation
          </AppButton>
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
      } catch {
        toast(SAVE_FAILED_MESSAGE, "error");
      }
    });
  }

  return (
    <div className="app-invite-row" data-testid="invitation-row">
      <div className="app-invite-who">
        <b>{row.name}</b> <span className="app-invite-email">· {row.email}</span>
        <div className="app-invite-sent">Sent {row.sent}</div>
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
