"use client";

import { MailCheck } from "lucide-react";
import { useState } from "react";
import { confirmRecovery, requestRecovery, setNewPassword, signIn } from "@/app/(private)/auth/actions";
import { Button, buttonVariants } from "@/components/alpha/button";
import { Field, TextInput } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { RECOVER_PATH, SIGN_IN_PATH } from "@/lib/auth/paths";
import { cn } from "@/lib/utils";
import { AuthActions, FormError, useAuthSubmit } from "./auth-frame";

export const NEW_PASSWORD_LABEL = "New password · 8 characters or more";

export function SignInForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useAuthSubmit(signIn);

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit({ email, password, next });
      }}
    >
      <div className="mx-4 mt-6 flex flex-col gap-3.5 laptop:mx-0">
        <Field label="Email">
          <TextInput
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jordan@example.com"
          />
        </Field>
        <Field label="Password">
          <TextInput name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError>{error}</FormError>
      </div>
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending} savingLabel="Signing in…">
          Sign in
        </Button>
        <p className="mt-3 text-center text-[13px] text-ink-3">
          <Link href={RECOVER_PATH} className="font-semibold text-ink">
            Forgot password?
          </Link>
        </p>
      </AuthActions>
    </form>
  );
}

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, submit } = useAuthSubmit(requestRecovery);

  if (sentTo) {
    return (
      <div className="flex flex-1 flex-col">
        <div role="status" className="mx-4 mt-6 flex items-start gap-3 rounded-group border border-line bg-surface p-4 text-[15px] leading-[22px] laptop:mx-0">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-done" aria-hidden />
          <span>
            Sent to <b className="font-semibold break-all">{sentTo}</b>. Check your inbox.
          </span>
        </div>
        <AuthActions>
          <Link href={SIGN_IN_PATH} className={cn(buttonVariants({ variant: "outline", size: "lg", block: true }))}>
            Back to sign in
          </Link>
        </AuthActions>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit({ email }, (result) => {
          if (result?.sent) setSentTo(email.trim());
        });
      }}
    >
      <div className="mx-4 mt-6 laptop:mx-0">
        <Field label="Email">
          <TextInput name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending} savingLabel="Sending…">
          Send recovery link
        </Button>
        <p className="mt-3 text-center text-[13px] text-ink-3">
          <Link href={SIGN_IN_PATH} className="font-semibold text-ink">
            Back to sign in
          </Link>
        </p>
      </AuthActions>
    </form>
  );
}

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useAuthSubmit(setNewPassword);

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit({ password });
      }}
    >
      <div className="mx-4 mt-6 flex flex-col gap-3.5 laptop:mx-0">
        <Field label={NEW_PASSWORD_LABEL}>
          <TextInput
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <FormError>{error}</FormError>
      </div>
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending}>
          Save password
        </Button>
      </AuthActions>
    </form>
  );
}

/** The recovery link's button: only this POST verifies the one-time token. */
export function ConfirmRecoveryForm({ tokenHash }: { tokenHash: string }) {
  const { pending, submit } = useAuthSubmit(confirmRecovery);

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit({ tokenHash });
      }}
    >
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending} savingLabel="Continuing…">
          Continue to reset password
        </Button>
      </AuthActions>
    </form>
  );
}
