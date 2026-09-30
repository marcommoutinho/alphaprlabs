import "server-only";
import webpush, { WebPushError } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPushServiceEndpoint } from "./device";

// Web Push transport: encrypts a small JSON payload for one device and hands
// it to that device's push service. A 2xx answer means the push service
// ACCEPTED the message ("sent"); it never proves delivery, display or that
// anyone read it. The reminder dispatcher (S13, src/lib/reminders/dispatch.ts)
// builds on sendPush().

/** What public/sw.js shows. `url` is a path under /app opened on tap (else /app). */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notification with the same tag. */
  tag: string;
  /** App icon badge count; 0 clears it. */
  badge?: number;
  /**
   * The reminder job it belongs to (reminder_jobs.id). A repeat of the same
   * job (delivery is at least once) replaces a notification of that job
   * still showing without alerting again (public/sw.js).
   */
  jobId?: string;
};

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushOptions = {
  /** Seconds the push service keeps an undelivered message. */
  ttlSeconds: number;
  /** Replaces an undelivered message with the same topic (≤ 32 URL-safe characters). */
  topic?: string;
  urgency?: "very-low" | "low" | "normal" | "high";
};

export type PushSendResult =
  | { id: string; status: "sent"; statusCode: number }
  /** The push service says the subscription no longer exists; it was disabled. */
  | { id: string; status: "gone"; statusCode: number }
  | { id: string; status: "failed"; statusCode?: number; error: string };

export type VapidConfig = { subject: string; publicKey: string; privateKey: string };

export type TransportRequest = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: string;
  ttlSeconds: number;
  topic?: string;
  urgency: NonNullable<PushOptions["urgency"]>;
  vapid: VapidConfig;
};

/** Sends one encrypted request; resolves with the push service's HTTP status, rejects on network errors. */
export type PushTransport = (request: TransportRequest) => Promise<{ statusCode: number }>;

export type PushDeps = {
  vapid: VapidConfig;
  transport: PushTransport;
  /** Marks a subscription the push service rejected as gone. */
  disableGone: (id: string) => Promise<void>;
};

const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_PAYLOAD_BYTES = 3000; // below the 4 KB Web Push limit after encryption

export const APP_NOTIFICATION_HOME = "/app";

/** sendPush's error for an endpoint that is not a browser push service (never retried). */
export const UNKNOWN_ENDPOINT = "endpoint is not a known push service";

/**
 * A notification's tap target: a relative path inside the researcher app
 * (/app or below), normalized; anything else becomes /app. Other paths on the
 * app host would redirect to the public site. public/sw.js applies the same rule.
 */
export function appNotificationPath(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return APP_NOTIFICATION_HOME;
  if (/[\\\s\x00-\x1f\x7f]/.test(path)) return APP_NOTIFICATION_HOME;
  const base = "https://app.invalid";
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return APP_NOTIFICATION_HOME;
  }
  // Resolved, so "/app/../about" and "/app/%2e%2e/about" are caught here.
  if (url.origin !== base || (url.pathname !== "/app" && !url.pathname.startsWith("/app/"))) {
    return APP_NOTIFICATION_HOME;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A reminder job id: a UUID (reminder_jobs.id); public/sw.js checks the same. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The payload sent to public/sw.js, validated. Throws on a programming error. */
export function encodePayload(payload: PushPayload): string {
  if (payload.badge !== undefined && !(Number.isInteger(payload.badge) && payload.badge >= 0)) {
    throw new Error("Push payload badge must be a whole number ≥ 0");
  }
  if (payload.jobId !== undefined && !JOB_ID.test(payload.jobId)) throw new Error("Push payload jobId must be a job id (a UUID)");
  const { title, body, tag, badge, jobId } = payload;
  const url = appNotificationPath(payload.url);
  const json = JSON.stringify({ title, body, url, tag, ...(badge === undefined ? {} : { badge }), ...(jobId === undefined ? {} : { jobId }) });
  if (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) throw new Error("Push payload is too large");
  return json;
}

export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  options: PushOptions,
  deps: PushDeps,
): Promise<PushSendResult> {
  if (options.topic !== undefined && !TOPIC.test(options.topic)) throw new Error("Invalid push topic");
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 0) throw new Error("Invalid push TTL");
  const body = encodePayload(payload);
  if (!isPushServiceEndpoint(target.endpoint)) {
    return { id: target.id, status: "failed", error: UNKNOWN_ENDPOINT };
  }

  let statusCode: number;
  try {
    ({ statusCode } = await deps.transport({
      subscription: { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload: body,
      ttlSeconds: options.ttlSeconds,
      topic: options.topic,
      urgency: options.urgency ?? "normal",
      vapid: deps.vapid,
    }));
  } catch (error) {
    return { id: target.id, status: "failed", error: errorText(error) };
  }

  if (statusCode >= 200 && statusCode < 300) return { id: target.id, status: "sent", statusCode };
  if (statusCode === 404 || statusCode === 410) {
    try {
      await deps.disableGone(target.id);
    } catch (error) {
      return { id: target.id, status: "failed", statusCode, error: `gone; disabling failed: ${errorText(error)}` };
    }
    return { id: target.id, status: "gone", statusCode };
  }
  return { id: target.id, status: "failed", statusCode, error: `push service answered ${statusCode}` };
}

/** Sends to several devices independently; one failure never stops the others. */
export function sendPushToAll(
  targets: readonly PushTarget[],
  payload: PushPayload,
  options: PushOptions,
  deps: PushDeps,
): Promise<PushSendResult[]> {
  return Promise.all(targets.map((target) => sendPush(target, payload, options, deps)));
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

// ── Production wiring ────────────────────────────────────────────────────────

/** VAPID keys from the environment, or null when push is not configured. */
export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
}

/** web-push over HTTPS. A non-2xx answer resolves with its status instead of throwing. */
export const webPushTransport: PushTransport = async (request) => {
  try {
    const response = await webpush.sendNotification(request.subscription, request.payload, {
      TTL: request.ttlSeconds,
      topic: request.topic,
      urgency: request.urgency,
      vapidDetails: request.vapid,
      timeout: 10_000,
    });
    return { statusCode: response.statusCode };
  } catch (error) {
    if (error instanceof WebPushError) return { statusCode: error.statusCode };
    throw error;
  }
};

/** Disables a gone subscription with the secret key (server-only; no user session involved). */
export async function disableGoneSubscription(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .update({ disabled_at: new Date().toISOString(), disabled_reason: "gone" })
    .eq("id", id)
    .is("disabled_at", null);
  if (error) throw new Error(error.message);
}

/** The settings "Send test notification" button: only while PUSH_TEST_ENABLED=true (gate G1). */
export const pushTestEnabled = (env: NodeJS.ProcessEnv = process.env) => env.PUSH_TEST_ENABLED === "true";

/** Real dependencies, or null when VAPID keys are not configured. */
export function defaultPushDeps(): PushDeps | null {
  const vapid = vapidConfig();
  return vapid ? { vapid, transport: webPushTransport, disableGone: disableGoneSubscription } : null;
}
