// A browser push subscription as the server accepts it. Pure: shared by the
// device server actions and the push sender.
import { z } from "zod";

/**
 * Push services the server will send to. The server makes an HTTPS request to
 * whatever endpoint a device registered, so only the browser vendors' push
 * services are accepted (Chrome/Android: FCM, Safari/iOS: Apple, Firefox:
 * Mozilla, Edge: Windows Push Notification Services), and their subdomains.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

const isPushServiceHost = (host: string) =>
  /^[a-z0-9.-]+$/.test(host) &&
  PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

// The canonical form, mirrored by public.is_canonical_push_endpoint() in the
// database: https, lowercase allowed host, no port, userinfo or fragment, only
// URL characters, percent-escapes with uppercase hex and never for unreserved
// characters, no dot segments and no empty "?".
const CANONICAL = /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;
const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/**
 * The one stored spelling of a push endpoint, or null if it is not a valid
 * push-service URL. Equivalent spellings of the same URL (host case, an
 * explicit :443, escaped unreserved characters, lowercase escapes) map to the
 * same string, so the unique endpoint column really is one row per device.
 * Fragments, userinfo, other ports and non-https are rejected outright.
 */
export function canonicalEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048 || !/^[\x21-\x7e]+$/.test(raw)) return null;
  if (raw.includes("#") || raw.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // URL lowercases the host and drops a default :443 port.
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (!isPushServiceHost(url.hostname)) return null;

  const tail = `${url.pathname}${url.search}`.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
  const canonical = `https://${url.hostname}${tail}`;
  if (
    canonical.length > 2048 ||
    !CANONICAL.test(canonical) ||
    /%(?![0-9A-F]{2})/.test(tail) || // stray "%"
    /\/\.\.?(\/|\?|$)/.test(tail) || // dot segment (e.g. from a decoded %2E)
    canonical.endsWith("?")
  ) {
    return null;
  }
  return canonical;
}

export const isPushServiceEndpoint = (endpoint: string) => canonicalEndpoint(endpoint) !== null;

const base64url = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** This browser's random device id (a uuid shared by all its tabs), or null. */
export const deviceIdOf = (raw: unknown): string | null => {
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data.toLowerCase() : null;
};

/**
 * `PushSubscription.toJSON()` plus a short device label, this browser's device
 * id and the save mode ("turn_on" only from the explicit button); the endpoint
 * comes out canonical.
 */
export const deviceSubscriptionSchema = z.object({
  endpoint: z.string().transform((value, ctx) => {
    const canonical = canonicalEndpoint(value);
    if (canonical === null) ctx.addIssue({ code: "custom", message: "not a push service endpoint" });
    return canonical ?? "";
  }),
  keys: z.object({ p256dh: base64url, auth: base64url }),
  label: z.string().max(80).catch(""),
  deviceId: z.uuid(),
  mode: z.enum(["turn_on", "sync"]),
});

export type DeviceSubscription = z.infer<typeof deviceSubscriptionSchema>;
