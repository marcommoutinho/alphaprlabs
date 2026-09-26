// Signing out without leaving this phone registered for reminders. Pure: the
// server action and the browser's push subscription are passed in.

export type SignOutDeps = {
  /** This device's push endpoint: the live subscription's, else the one remembered here. */
  endpoint: string | null;
  /** This browser's device id (the device is marked off for the account signing out). */
  deviceId: string | null;
  /** The sign-out server action: `ok: false` if the device row could not be disabled (session kept). */
  signOut: (input: { endpoint: string | null; deviceId: string | null }) => Promise<{ ok: boolean }>;
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
  if ((await deps.signOut({ endpoint: deps.endpoint, deviceId: deps.deviceId })).ok) return "signed-out";
  // The server kept the row active. Without a browser subscription the push
  // service rejects every send (and the row is disabled as gone).
  if (!(await deps.unsubscribe().catch(() => false))) return "failed";
  return (await deps.signOut({ endpoint: null, deviceId: null })).ok ? "signed-out" : "failed";
}
