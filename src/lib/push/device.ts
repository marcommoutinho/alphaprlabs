// A browser push subscription as the server accepts it. Pure: shared by the
// device server actions and the push sender.
import { z } from "zod";

/**
 * Push services the server will send to. The server makes an HTTPS request to
 * whatever endpoint a device registered, so only the browser vendors' push
 * services are accepted (Chrome/Android: FCM, Safari/iOS: Apple, Firefox:
 * Mozilla, Edge: Windows Push Notification Services).
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

const base64url = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** `PushSubscription.toJSON()` plus a short device label. */
export const deviceSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceEndpoint),
  keys: z.object({ p256dh: base64url, auth: base64url }),
  label: z.string().max(80).catch(""),
});

export type DeviceSubscription = z.infer<typeof deviceSubscriptionSchema>;
