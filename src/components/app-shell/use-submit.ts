"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { SAVE_FAILED_MESSAGE, useToast, type ToastTone } from "./toast";

/** A server action's answer: an inline error and/or a toast (error tone unless given). */
export type SubmitResult = { error?: string; toast?: string; tone?: ToastTone } | undefined | void;

/**
 * Calls a server action from a form without resetting the form (inputs stay
 * as typed). While pending the submit button shows "Saving…"/"Sending…". An
 * action that redirects simply navigates (Next.js rejects the call with its
 * redirect error, which goes back to Next.js, not to the toast); a failed
 * request shows the handoff's save-failure toast.
 */
export function useSubmit<Input, Result extends SubmitResult>(action: (input: Input) => Promise<Result>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const toast = useToast();

  function submit(input: Input, onResult?: (result: Result) => void) {
    startTransition(async () => {
      let result: Result;
      try {
        result = await action(input);
      } catch (error) {
        unstable_rethrow(error);
        toast(SAVE_FAILED_MESSAGE, "error");
        return;
      }
      setError(result?.error);
      if (result?.toast) toast(result.toast, result.tone ?? "error");
      onResult?.(result);
    });
  }

  return { pending, error, setError, submit };
}
