"use client";

import { useState } from "react";
import { ChevronRight, Eye, Lock } from "lucide-react";
import { Button } from "@/components/alpha/button";
import { Field, TextInput } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { useAlphaToast } from "@/components/alpha/toast";
import { BUSINESS_PATH } from "@/components/business/frame";
import { BackBar } from "@/components/admin/states";
import { type InviteActionResult, resendInvitationAction, sendInvitation } from "@/app/(private)/admin/people/actions";
import { ADMIN_CONFIRM_POINTS, ADMIN_CONFIRM_SUBMIT, ADMIN_CONFIRM_TITLE, type InvitationRole, ROLE_LABEL } from "@/lib/invitations/state";
import { INVITE_NOTE, type PeopleRow, type PeopleView, type PersonStatus } from "@/lib/people/view";
import { cn } from "@/lib/utils";

const SEND_UNSURE = "Couldn't confirm the invitation was sent. Check the list before sending it again.";

/**
 * A11 / D8 People (admins only). Inviting is the only way in, so it sits at
 * the top: an email and Invite on the phone (the rest in a sheet), D8's
 * card on a laptop. Each researcher shows whether they share their history
 * with the team; only those who share open (A12). Invitations still open
 * are listed in their role's group, with Resend once expired or failed.
 */
export function PeopleScreen({ view }: { view: PeopleView }) {
  const [sheet, setSheet] = useState<{ email: string; token: number } | null>(null);
  const [quickEmail, setQuickEmail] = useState("");

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-9 laptop:pt-7 laptop:pb-16" data-testid="people">
      <BackBar href={BUSINESS_PATH} label="Business" />
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <div className="hidden font-mono text-[13px] font-medium text-ink-3 laptop:block" data-testid="people-meta">
          {view.meta}
        </div>
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5">People</h1>
      </header>

      {/* A11: email + Invite; the sheet asks for the name and role. */}
      <form
        className="mx-3 mt-3.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 laptop:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          setSheet({ email: quickEmail, token: Date.now() });
        }}
      >
        <label className="sr-only" htmlFor="quick-invite-email">
          Email to invite
        </label>
        <input
          id="quick-invite-email"
          type="email"
          autoComplete="off"
          value={quickEmail}
          onChange={(event) => setQuickEmail(event.currentTarget.value)}
          placeholder="name@email.com"
          className="h-[52px] min-w-0 rounded-[14px] border border-line bg-surface px-3.5 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)]"
        />
        <Button type="submit" variant="ink" className="h-[52px] rounded-[14px] px-[18px] text-base" data-testid="quick-invite">
          Invite
        </Button>
      </form>

      <div className="laptop:mt-5 laptop:grid laptop:grid-cols-[320px_minmax(0,1fr)] laptop:items-start laptop:gap-4">
        <section aria-labelledby="invite-card-title" className="hidden rounded-group border border-line bg-surface px-5 py-[18px] laptop:block" data-testid="invite-card">
          <h2 id="invite-card-title" className="text-[17px] font-semibold">
            Invite a researcher
          </h2>
          <InviteForm initialEmail="" onSent={() => undefined} idPrefix="card" />
        </section>

        <div className="laptop:rounded-group laptop:border laptop:border-line laptop:bg-surface laptop:px-5">
          <PeopleGroup label="Researchers" rows={view.researchers} testId="researchers" />
          <AdminsGroup rows={view.admins} />
        </div>
      </div>

      <Sheet open={sheet !== null} onOpenChange={(open) => (open ? undefined : setSheet(null))}>
        <SheetContent title="Invite someone" size="auto">
          {sheet ? (
            <div className="px-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
              <InviteForm
                key={sheet.token}
                initialEmail={sheet.email}
                idPrefix="sheet"
                onSent={() => {
                  setSheet(null);
                  setQuickEmail("");
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}

function StatusText({ status, className }: { status: PersonStatus; className?: string }) {
  const tone = {
    shared: "font-semibold text-done",
    private: "text-ink-3 laptop:text-ink-2",
    invited: "font-semibold text-signal-ink",
    expired: "font-semibold text-low",
    failed: "font-semibold text-missed",
    admin: "text-ink-2",
  }[status.tone];
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", tone, className)} data-testid="person-status" data-tone={status.tone}>
      {status.tone === "shared" ? <Eye className="size-3.5 shrink-0" aria-hidden /> : null}
      {status.tone === "private" ? <Lock className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{status.text}</span>
    </span>
  );
}

function ResendButton({ row, className }: { row: PeopleRow; className?: string }) {
  const toast = useAlphaToast();
  const [sending, setSending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-10 rounded-[12px] text-[14px]", className)}
      saving={sending}
      savingLabel="Sending…"
      data-testid="resend"
      onClick={async () => {
        setSending(true);
        let result: InviteActionResult;
        try {
          result = await resendInvitationAction(row.id);
        } catch {
          result = { toast: SEND_UNSURE, tone: "error" };
        }
        setSending(false);
        if (result.toast) (result.tone === "error" ? toast.error : toast.success)({ message: result.toast });
      }}
    >
      Resend
    </Button>
  );
}

function PeopleGroup({ label, rows, testId }: { label: string; rows: PeopleRow[]; testId: string }) {
  return (
    <section aria-label={`${label} · ${rows.length}`} data-testid={testId}>
      <h2 className="mx-5 mt-5 mb-2 text-[13px] font-semibold text-ink-2 laptop:hidden">
        {label} · {rows.length}
      </h2>
      {rows.length === 0 ? (
        <p className="mx-5 text-[15px] text-ink-2 laptop:mx-0 laptop:py-4">No researchers yet. Invite one above.</p>
      ) : (
        <>
          <ul className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:hidden">
            {rows.map((row) => (
              <li key={row.key}>
                <PhoneRow row={row} />
              </li>
            ))}
          </ul>
          <PeopleTable rows={rows} header />
        </>
      )}
    </section>
  );
}

function Avatar({ row }: { row: PeopleRow }) {
  return row.kind === "invite" ? (
    <span aria-hidden className="size-9 shrink-0 rounded-full border-[1.5px] border-dashed border-ink-3" />
  ) : (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-[13px] font-semibold">
      {row.initials}
    </span>
  );
}

function PhoneRow({ row }: { row: PeopleRow }) {
  const body = (
    <>
      <Avatar row={row} />
      <span className="min-w-0 flex-1">
        {row.kind === "invite" ? (
          <span className="block truncate font-mono text-[15px] font-medium">{row.email}</span>
        ) : (
          <span className="block truncate text-base font-semibold">
            {row.name}
            {row.you ? <span className="font-normal text-ink-3"> (you)</span> : null}
          </span>
        )}
        <StatusText status={row.status} className="mt-0.5 text-[13px]" />
      </span>
    </>
  );
  if (row.historyHref) {
    return (
      <Link href={row.historyHref} className="flex items-center gap-3 py-3 pr-3 pl-4" data-testid="person-row" data-kind={row.kind}>
        {body}
        <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 py-3 pr-3 pl-4" data-testid="person-row" data-kind={row.kind}>
      {body}
      {row.canResend ? <ResendButton row={row} /> : null}
    </div>
  );
}

// Status keeps room for "Private · revoked Sep 30"; name and email truncate first.
const TABLE_COLUMNS = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(180px,1.3fr)_110px] items-center gap-3";

/** D8's table: Name, Email, Status and View history / Resend. */
function PeopleTable({ rows, header }: { rows: PeopleRow[]; header: boolean }) {
  return (
    <div className="hidden laptop:block" role="table" aria-label="People">
      {header ? (
        <div role="row" className={cn(TABLE_COLUMNS, "border-b border-line pt-3 pb-2 text-[12px] text-ink-3")}>
          <span role="columnheader">Name</span>
          <span role="columnheader">Email</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" className="sr-only">
            Action
          </span>
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={row.key} role="row" className={cn(TABLE_COLUMNS, "border-b border-line py-3 text-[14px] last:border-b-0")} data-testid="person-line" data-kind={row.kind}>
          <span role="cell" className={cn("truncate", row.name ? "font-semibold" : "text-ink-3")}>
            {row.name ?? "—"}
            {row.you ? <span className="font-normal text-ink-3"> (you)</span> : null}
          </span>
          <span role="cell" className="truncate font-mono text-[13px] text-ink-2">
            {row.email}
          </span>
          <span role="cell" className="min-w-0">
            <StatusText status={row.status} />
          </span>
          <span role="cell" className="flex justify-end">
            {row.historyHref ? (
              <Link href={row.historyHref} className="font-semibold" data-testid="view-history">
                View history
              </Link>
            ) : row.canResend ? (
              <ResendButton row={row} className="h-[34px] rounded-[10px] px-3 text-[13px]" />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A11: the admins as a line of names (invitations still open as rows); D8: a sub-group of the table. */
function AdminsGroup({ rows }: { rows: PeopleRow[] }) {
  const accounts = rows.filter((row) => row.kind === "account");
  const invites = rows.filter((row) => row.kind === "invite");
  return (
    <section aria-label={`Admins · ${rows.length}`} data-testid="admins">
      <h2 className="mx-5 mt-5 mb-2 text-[13px] font-semibold text-ink-2 laptop:mx-0 laptop:mt-0 laptop:pt-4 laptop:pb-1.5 laptop:text-[12px] laptop:text-ink-3">
        Admins<span className="laptop:hidden"> · {rows.length}</span>
      </h2>
      <p className="mx-5 text-[15px] text-ink-2 laptop:hidden">
        {accounts.map((row, i) => (
          <span key={row.key}>
            {i ? " · " : ""}
            {row.historyHref ? (
              <Link href={row.historyHref} className="text-signal-ink">
                {row.name}
              </Link>
            ) : (
              row.name
            )}
            {row.you ? " (you)" : ""}
          </span>
        ))}
      </p>
      {invites.length ? (
        <ul className="mx-3 mt-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:hidden">
          {invites.map((row) => (
            <li key={row.key}>
              <PhoneRow row={row} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="laptop:border-t laptop:border-line">
        <PeopleTable rows={rows} header={false} />
      </div>
    </section>
  );
}

/** Name, email, Researcher | Admin, Send invitation; an admin invitation asks for confirmation first (Marco, 2026-09-27). */
function InviteForm({ initialEmail, onSent, idPrefix }: { initialEmail: string; onSent: () => void; idPrefix: string }) {
  const toast = useAlphaToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [role, setRole] = useState<InvitationRole>("researcher");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    let result: InviteActionResult;
    try {
      result = await sendInvitation({ name, email, role });
    } catch {
      result = { toast: SEND_UNSURE, tone: "error" };
    }
    setSending(false);
    setConfirming(false);
    if (result.error) setError(result.error);
    if (result.toast) (result.tone === "error" ? toast.error : toast.success)({ message: result.toast });
    if (result.sent) {
      setName("");
      setEmail("");
      setRole("researcher");
      onSent();
    }
  }

  return (
    <form
      noValidate
      className="mt-3 flex flex-col gap-3"
      data-testid={`invite-form-${idPrefix}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        if (role === "admin") setConfirming(true);
        else void send();
      }}
    >
      <Field label="Name">
        <TextInput compact value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="off" className="laptop:bg-paper" name="name" />
      </Field>
      <Field label="Email" error={error}>
        <TextInput
          compact
          mono
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setError(null);
          }}
          autoComplete="off"
          placeholder="name@example.com"
          className="text-[14px] laptop:bg-paper"
          name="email"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span id={`${idPrefix}-role`} className="text-[13px] font-semibold text-ink-2">
          Access
        </span>
        <Segmented<InvitationRole>
          aria-labelledby={`${idPrefix}-role`}
          value={role}
          onValueChange={(next) => {
            setRole(next);
            setConfirming(false);
          }}
          options={(["researcher", "admin"] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))}
          size="sm"
        />
      </div>
      {confirming ? (
        <div role="group" aria-label={ADMIN_CONFIRM_TITLE} className="rounded-now bg-low-tint px-4 py-3.5" data-testid="admin-confirm">
          <p className="text-[15px] font-semibold">{ADMIN_CONFIRM_TITLE}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-[1.45] text-ink-2">
            {ADMIN_CONFIRM_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="ink" size="md" className="flex-1 text-[14px]" saving={sending} savingLabel="Sending…" onClick={() => void send()}>
              {ADMIN_CONFIRM_SUBMIT}
            </Button>
            <Button variant="outline" size="md" className="text-[14px]" disabled={sending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant="ink" size="md" className="text-[15px]" saving={sending} savingLabel="Sending…" data-testid="send-invitation">
          Send invitation
        </Button>
      )}
      <p className="text-[13px] leading-[1.45] text-ink-3">{INVITE_NOTE}</p>
    </form>
  );
}
