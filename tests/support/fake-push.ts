// Browser fakes for "Reminders on this phone" journeys (Playwright). Headless
// Chromium has no push service and reports notifications as denied, so both
// are emulated in the page; the server side stays real.
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Headless Chromium reports notifications as denied whatever is granted, so
 * the permission is emulated: `initial`, "granted" once requested, and
 * window.setPermission() for a change made in the phone's Settings.
 */
export function emulatePermission(target: Page | BrowserContext, initial: NotificationPermission) {
  return target.addInitScript((start) => {
    let state = start;
    Object.defineProperty(Notification, "permission", { get: () => state, configurable: true });
    Notification.requestPermission = async () => (state = "granted");
    Object.assign(window, { setPermission: (next: NotificationPermission) => (state = next) });
  }, initial);
}

/** Fake PushManager with one subscription at `endpoint`; window.dropSubscription() loses it (as iOS can). */
export function fakePushService(target: Page | BrowserContext, endpoint: string) {
  return target.addInitScript((url) => {
    let current: object | null = null;
    let subscribeCalls = 0;
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" };
    const subscription = {
      endpoint: url,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: url, keys }),
      unsubscribe: async () => ((current = null), true),
    };
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async () => ((subscribeCalls += 1), (current = subscription)) as unknown as PushSubscription;
    Object.assign(window, { dropSubscription: () => (current = null), subscribeCalls: () => subscribeCalls });
  }, endpoint);
}
