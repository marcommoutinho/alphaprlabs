"use client";

import { useState } from "react";
import Link from "@/components/alpha/link";
import { confirmRecovery, requestRecovery, setNewPassword, signIn } from "@/app/(private)/auth/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { RECOVER_PATH, SIGN_IN_PATH } from "@/lib/auth/paths";

export function SignInForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useSubmit(signIn);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ email, password, next });
      }}
    >
      <div className="app-auth-fields">
        <Field label="Email">
          <input
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jordan@example.com"
          />
        </Field>
        <Field label="Password">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <InlineError>{error}</InlineError>
      </div>
      <AppButton type="submit" block saving={pending} className="app-auth-submit--signin">
        Sign in
      </AppButton>
      <div className="app-auth-links">
        <Link href={RECOVER_PATH}>Forgot password?</Link>
      </div>
    </form>
  );
}

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, submit } = useSubmit(requestRecovery);

  if (sentTo) {
    return (
      <div className="app-auth-sent" role="status">
        Sent to <b>{sentTo}</b>. Check your inbox.
        <Link href={SIGN_IN_PATH}>Back to sign in</Link>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ email }, (result) => {
          if (result?.sent) setSentTo(email.trim());
        });
      }}
    >
      <Field label="Email" className="app-auth-recover-field">
        <input
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <AppButton type="submit" block saving={pending} savingLabel="Sending…" className="app-auth-submit--tight">
        Send recovery link
      </AppButton>
      <Link href={SIGN_IN_PATH} className="app-auth-back">
        Back to sign in
      </Link>
    </form>
  );
}

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useSubmit(setNewPassword);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ password });
      }}
    >
      <div className="app-auth-fields">
        <Field label="New password · at least 8 characters">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <InlineError>{error}</InlineError>
      </div>
      <AppButton type="submit" block saving={pending} className="app-auth-submit">
        Save password
      </AppButton>
    </form>
  );
}

/** The recovery link's button: only this POST verifies the one-time token. */
export function ConfirmRecoveryForm({ tokenHash }: { tokenHash: string }) {
  const { pending, submit } = useSubmit(confirmRecovery);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({ tokenHash });
      }}
    >
      <AppButton type="submit" block saving={pending} savingLabel="Continuing…" className="app-auth-submit">
        Continue to reset password
      </AppButton>
    </form>
  );
}
