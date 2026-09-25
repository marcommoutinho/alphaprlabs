// Signing out without leaving this phone registered for reminders. Pure: the
// server action and the browser's push subscription are passed in.

export type SignOutDeps = {
  /** This device's push endpoint: the live subscription's, else the one remembered here. */
  endpoint: string | null;
  /** The sign-out server action: redirects on success, `{ ok: false }` if the device row could not be disabled. */
  signOut: (input: { endpoint: string | null }) => Promise<{ ok: false } | undefined | void>;
  /** Unsubscribes this browser's push subscription; true if none remains. */
  unsubscribe: () => Promise<boolean>;
};

/**
 * "signed-out" once the session has ended; "failed" when neither the server
 * could disable this device's row nor the browser could drop its
 * subscription — the session is kept so the person can retry, instead of
 * leaving a signed-out phone that still receives reminders.
 */
export async function signOutDevice(deps: SignOutDeps): Promise<"signed-out" | "failed"> {
  const first = await deps.signOut({ endpoint: deps.endpoint });
  if (first?.ok !== false) return "signed-out";
  // The server kept the row active. Without a browser subscription the push
  // service rejects every send (and the row is disabled as gone).
  if (!(await deps.unsubscribe().catch(() => false))) return "failed";
  const second = await deps.signOut({ endpoint: null });
  return second?.ok === false ? "failed" : "signed-out";
}
