"use server";

import { getSessionPerson } from "@/lib/auth/session";
import { canonicalEndpoint, deviceSubscriptionSchema } from "@/lib/push/device";
import { defaultPushDeps, pushTestEnabled, sendPushToAll } from "@/lib/push/send";
import { createClient } from "@/lib/supabase/server";

// "Reminders on this phone" (C2). Every write runs under the caller's own
// session through a database function bound to auth.uid(), so a device can
// only ever be registered to, or turned off for, the signed-in researcher.

const signedInResearcher = async () => {
  const person = await getSessionPerson();
  return person?.role === "researcher" && person.acknowledged ? person : null;
};

/** Registers (or refreshes) this device's push subscription for the signed-in researcher. */
export async function saveDevice(input: unknown): Promise<{ ok: boolean }> {
  if (!(await signedInResearcher())) return { ok: false };
  const parsed = deviceSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_device_label: parsed.data.label,
  });
  return { ok: !error && data !== null };
}

/** "Turn off reminders": disables the signed-in researcher's row for this device. */
export async function turnOffDevice(input: { endpoint: unknown }): Promise<{ ok: boolean }> {
  if (!(await signedInResearcher())) return { ok: false };
  const endpoint = canonicalEndpoint(input.endpoint);
  // Not a push-service endpoint: no row can exist for it.
  if (endpoint === null) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.rpc("disable_push_subscription", { p_endpoint: endpoint, p_reason: "turned_off" });
  return { ok: !error };
}

type TestResult = { toast: string; tone: "info" | "error" };

/**
 * Sends a test notification to the signed-in researcher's own active devices.
 * Reports what the push services accepted ("sent"), never delivery.
 */
export async function sendTestNotification(): Promise<TestResult> {
  if (!pushTestEnabled()) return { toast: "Test notifications are turned off.", tone: "error" };
  const person = await signedInResearcher();
  if (!person) return { toast: "Sign in again to send a test notification.", tone: "error" };
  const deps = defaultPushDeps();
  if (!deps) return { toast: "Push is not configured on this server.", tone: "error" };

  // Own rows only (RLS), and only devices with reminders on.
  const supabase = await createClient();
  const { data: devices, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", person.id)
    .is("disabled_at", null);
  if (error) return { toast: "Could not send the test notification. Try again.", tone: "error" };
  if (devices.length === 0) return { toast: "No device has reminders on.", tone: "error" };

  const results = await sendPushToAll(
    devices,
    {
      title: "Alpha PR Labs",
      body: "Test notification — reminders work on this phone.",
      url: "/app/notifications",
      tag: "test",
      badge: 1,
    },
    { ttlSeconds: 600, topic: "test", urgency: "high" },
    deps,
  );
  const sent = results.filter((result) => result.status === "sent").length;
  const notSent = results.length - sent;
  for (const result of results) {
    if (result.status !== "sent") console.error("Test push not sent:", result.status, "statusCode" in result ? result.statusCode : "");
  }
  if (sent === 0) return { toast: "Could not send the test notification. Try again.", tone: "error" };
  const devicesSent = `${sent} device${sent === 1 ? "" : "s"}`;
  return {
    toast: notSent ? `Sent to ${devicesSent}; ${notSent} could not be reached.` : `Sent to ${devicesSent}.`,
    tone: "info",
  };
}
