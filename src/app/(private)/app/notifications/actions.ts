"use server";

import { getSessionPerson } from "@/lib/auth/session";
import { canonicalEndpoint, deviceIdOf, deviceSubscriptionSchema } from "@/lib/push/device";
import { defaultPushDeps, pushTestEnabled, sendPushToAll } from "@/lib/push/send";
import { createClient } from "@/lib/supabase/server";

// "Reminders on this phone" (C2). Every write runs under the caller's own
// session through a database function bound to auth.uid(), so a device can
// only ever be registered to, or turned off for, the signed-in researcher.

const signedInResearcher = async () => {
  const person = await getSessionPerson();
  return person?.role === "researcher" && person.acknowledged ? person : null;
};

export type SaveDeviceResult = { status: "saved" | "refused_off" | "failed" };

/**
 * Registers ("turn_on", the explicit button only) or refreshes ("sync", the
 * background re-registration) this device's push subscription for the
 * signed-in researcher. "refused_off": the database kept the device off (it
 * was turned off or signed out of, or the endpoint is disabled or another
 * account's); only an explicit turn on can switch it back on.
 */
export async function saveDevice(input: unknown): Promise<SaveDeviceResult> {
  if (!(await signedInResearcher())) return { status: "failed" };
  const parsed = deviceSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_device_label: parsed.data.label,
    p_device_id: parsed.data.deviceId,
    p_mode: parsed.data.mode,
  });
  if (error || (data !== "saved" && data !== "refused_off")) return { status: "failed" };
  return { status: data };
}

/**
 * "Turn off reminders": disables the signed-in researcher's rows for this
 * device (its endpoint and its device id) and marks the device off.
 */
export async function turnOffDevice(input: { endpoint: unknown; deviceId?: unknown }): Promise<{ ok: boolean }> {
  if (!(await signedInResearcher())) return { ok: false };
  // A non-push-service endpoint has no row; the device id still marks it off.
  const endpoint = canonicalEndpoint(input.endpoint);
  const deviceId = deviceIdOf(input.deviceId);
  if (endpoint === null && deviceId === null) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.rpc("disable_push_subscription", {
    p_reason: "turned_off",
    p_endpoint: endpoint ?? undefined,
    p_device_id: deviceId ?? undefined,
  });
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
