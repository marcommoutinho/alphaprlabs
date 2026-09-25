// Reminder readiness on this device (C2): what the browser supports, whether
// the app is installed, and the resulting state shown on the step-3 and
// settings screens. Pure: the browser facts are passed in, so the rules are
// testable and the hook stays thin.

export type Permission = "default" | "granted" | "denied";

export type DeviceFacts = {
  /** serviceWorker, PushManager and Notification all exist. */
  pushApi: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** display-mode: standalone, or iOS navigator.standalone. */
  standalone: boolean;
  permission: Permission | null;
};

/**
 * - unsupported: this browser can't receive push (and installing won't help)
 * - needs-install: iPhone/iPad in Safari; push works once added to the home screen
 * - denied: the OS/browser blocks notifications for the app
 * - not-requested: can be turned on
 * - enabled: this device is registered for the signed-in person
 * - failed: permission granted, but registering the device failed
 */
export type ReminderStatus = "unsupported" | "needs-install" | "denied" | "not-requested" | "enabled" | "failed";

/** iPhone, iPod or iPad, including iPadOS reporting itself as a Mac with touch. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** iOS/iPadOS version from the user agent ("OS 17_4" or iPadOS's "Version/17.4"), or null. */
export function appleOsVersion(userAgent: string): number | null {
  const match = /OS (\d+)_(\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return match ? Number(match[1]) + Number(match[2]) / 100 : null;
}

/** Web Push on iPhone/iPad needs iOS/iPadOS 16.4+ and the app on the home screen. */
export function appleCanPush(userAgent: string): boolean {
  const version = appleOsVersion(userAgent);
  return version === null || version >= 16.04;
}

export function reminderStatus(
  facts: DeviceFacts,
  device: { subscribed: boolean; failed: boolean },
): ReminderStatus {
  const apple = isAppleMobile(facts.userAgent, facts.maxTouchPoints);
  // iOS exposes push only inside the installed (home screen) app.
  if (apple && !facts.standalone) return appleCanPush(facts.userAgent) ? "needs-install" : "unsupported";
  if (!facts.pushApi) return "unsupported";
  if (facts.permission === "denied") return "denied";
  if (device.failed) return "failed";
  if (facts.permission === "granted" && device.subscribed) return "enabled";
  return "not-requested";
}

// Prototype labels ("Push supported", "Notification permission").
export const STATUS_LABEL: Record<ReminderStatus, string> = {
  unsupported: "Unavailable",
  "needs-install": "Not requested",
  denied: "Denied",
  "not-requested": "Not requested",
  enabled: "Enabled",
  failed: "Registration failed",
};

export const statusTone = (status: ReminderStatus): "good" | "bad" | "neutral" =>
  status === "enabled" ? "good" : status === "denied" || status === "failed" ? "bad" : "neutral";

/** Short, non-identifying label stored with the device, e.g. "iPhone" or "Android · Chrome". */
export function deviceLabel(userAgent: string, maxTouchPoints: number): string {
  const device = /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
    ? "iPad"
    : /iPhone|iPod/.test(userAgent)
      ? "iPhone"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Macintosh/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /SamsungBrowser/.test(userAgent)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(userAgent)
        ? "Firefox"
        : /Chrome|CriOS/.test(userAgent)
          ? "Chrome"
          : /Safari/.test(userAgent)
            ? "Safari"
            : "";
  return browser ? `${device} · ${browser}` : device;
}

/** VAPID public key (base64url) → the bytes PushManager.subscribe expects. */
export function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
