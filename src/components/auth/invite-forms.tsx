"use client";

import { useState } from "react";
import { acknowledge, createAccount } from "@/app/(private)/auth/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";

/** C1 step 1: name (prefilled), email from the invitation (read-only), password. */
export function AccountSetupForm({ token, name: invitedName, email }: { token: string; name: string; email: string }) {
  const [name, setName] = useState(invitedName);
  const [password, setPassword] = useState("");
  const { pending, error, submit } = useSubmit(createAccount);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ token, name, password });
      }}
    >
      <div className="app-auth-fields app-auth-fields--roomy">
        <Field label="Name">
          <input name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email (from your invitation)">
          <input name="email" type="email" autoComplete="username" value={email} readOnly />
        </Field>
        <Field label="Password · at least 8 characters">
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
        Continue
      </AppButton>
    </form>
  );
}

/** C1 step 2: the required researcher acknowledgement. */
export function AcknowledgementForm() {
  const [accepted, setAccepted] = useState(false);
  const { pending, error, submit } = useSubmit(acknowledge);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ accepted });
      }}
    >
      <label className="app-auth-check">
        <input type="checkbox" name="accepted" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>I have read the acknowledgement and confirm I am a researcher.</span>
      </label>
      <InlineError>{error}</InlineError>
      <AppButton type="submit" block saving={pending} className="app-auth-submit">
        Continue
      </AppButton>
    </form>
  );
}
