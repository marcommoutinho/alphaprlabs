"use client";

import { useId, useState } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { acknowledge, createAccount } from "@/app/(private)/auth/actions";
import { Button } from "@/components/alpha/button";
import { Checkbox, Field, TextInput } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { TERMS_CHECKBOX } from "@/lib/auth/terms";
import { AuthActions, FormError, useAuthSubmit } from "./auth-frame";
import { DisclaimerBox } from "./disclaimer";

export const PASSWORD_LABEL = "Password · 8 characters or more";
export const ACKNOWLEDGE_LABEL = TERMS_CHECKBOX;

/**
 * R14: name (prefilled from the invitation), the invitation's email
 * (read-only) and a password; Continue, then "Valid until … · Already have
 * an account? Sign in".
 */
export function AccountSetupForm({
  token,
  name: invitedName,
  email,
  validUntil,
  note,
}: {
  token: string;
  name: string;
  email: string;
  /** "Oct 14" */
  validUntil: string;
  /** The role note under the fields. */
  note: string;
}) {
  const [name, setName] = useState(invitedName);
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useAuthSubmit(createAccount);

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit({ token, name, password });
      }}
    >
      <div className="mx-4 mt-6 flex flex-col gap-3.5 laptop:mx-0">
        <Field label="Name">
          <TextInput name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email · from your invitation">
          {/* The address is shown wrapping, so a long one is never cut off on a phone; the
              read-only input the label names is what a password manager saves as the username. */}
          <FieldPrimitive.Control name="email" type="email" autoComplete="username" value={email} readOnly tabIndex={-1} className="sr-only" />
          <div aria-hidden className="rounded-[14px] bg-sunken px-3.5 py-[15px] font-mono text-[15px] leading-[22px] break-all text-ink-2">
            {email}
          </div>
        </Field>
        <Field label={PASSWORD_LABEL}>
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
        <p className="text-[13px] leading-[18px] text-ink-3" data-testid="invite-role-note">
          {note}
        </p>
      </div>
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending}>
          Continue
        </Button>
        <p className="mt-3 text-center text-[13px] text-ink-3">
          Valid until {validUntil} · Already have an account?{" "}
          <Link href={SIGN_IN_PATH} className="font-semibold text-ink">
            Sign in
          </Link>
        </p>
      </AuthActions>
    </form>
  );
}

/**
 * R15: the research terms in their scroll box, the checkbox, and "Agree and
 * continue", disabled until the box is ticked (the server checks it too).
 */
export function AcknowledgementForm() {
  const [accepted, setAccepted] = useState(false);
  const { pending, error, submit } = useAuthSubmit(acknowledge);
  const labelId = useId();

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (accepted) submit({ accepted });
      }}
    >
      <DisclaimerBox className="mx-3 mt-5 h-[330px] laptop:mx-0" />
      <label className="mx-4 mt-4 flex cursor-pointer items-start gap-3 text-[15px] leading-[1.45] laptop:mx-0">
        <Checkbox checked={accepted} onCheckedChange={setAccepted} aria-labelledby={labelId} />
        <span id={labelId}>{ACKNOWLEDGE_LABEL}</span>
      </label>
      <FormError className="mx-4 mt-3 laptop:mx-0">{error}</FormError>
      <AuthActions>
        <Button type="submit" variant="ink" size="lg" block needsConnection saving={pending} disabled={!accepted} data-testid="agree">
          Agree and continue
        </Button>
      </AuthActions>
    </form>
  );
}
