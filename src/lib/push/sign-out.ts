// Signing out without leaving this phone registered for reminders. Pure: the
// server action and the browser's push subscription are passed in.

export type SignOutDeps = {
  /** This device's push endpoint: the live subscription's, else the one remembered here. */
  endpoint: string | null;
  /** This browser's device id (the device is marked off for the account signing out). */
  deviceId: string;
  /** The sign-out server action: `ok: false` if the device could not be marked off (session kept). */
  signOut: (input: { endpoint: string | null; deviceId: string }) => Promise<{ ok: boolean }>;
  /** Unsubscribes this browser's push subscription; true if none remains. */
  unsubscribe: () => Promise<boolean>;
};

/**
 * "signed-out" once the server has marked this device off and the session has
 * ended. If the first attempt fails, the browser subscription is dropped (best
 * effort) and the sign-out retried once with the same device id; if that also
 * fails the session is kept ("failed") so the person can retry. Never signed
 * out without the off mark: a sync pending in another tab could otherwise
 * register a new endpoint and switch the phone back on.
 */
export async function signOutDevice(deps: SignOutDeps): Promise<"signed-out" | "failed"> {
  const device = { endpoint: deps.endpoint, deviceId: deps.deviceId };
  if ((await deps.signOut(device)).ok) return "signed-out";
  await deps.unsubscribe().catch(() => false);
  return (await deps.signOut(device)).ok ? "signed-out" : "failed";
}
