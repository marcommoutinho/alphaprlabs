import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { isAppFileOffAppHost } from "@/lib/host-routing";
import { canonicalEndpoint, deviceSubscriptionSchema, isPushServiceEndpoint } from "@/lib/push/device";
import { deviceLabel, reminderStatus, type DeviceFacts } from "@/lib/push/readiness";
import {
  appNotificationPath,
  sendPush,
  sendPushToAll,
  type PushDeps,
  type TransportRequest,
} from "@/lib/push/send";
import { signOutDevice } from "@/lib/push/sign-out";

const target = { id: "sub-1", endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "BPk", auth: "au" };
const payload = { title: "Alpha PR Labs", body: "Test", url: "/app/notifications", tag: "test", badge: 1 };
const options = { ttlSeconds: 600, topic: "test", urgency: "high" as const };

function deps(answer: (request: TransportRequest) => Promise<{ statusCode: number }>) {
  const disabled: string[] = [];
  const transport = vi.fn(answer);
  const value: PushDeps = {
    vapid: { subject: "mailto:test@example.test", publicKey: "pub", privateKey: "priv" },
    transport,
    disableGone: async (id) => {
      disabled.push(id);
    },
  };
  return { value, transport, disabled };
}

describe("push sending", () => {
  it("reports provider acceptance as sent, with the payload shape, TTL, topic and urgency", async () => {
    const { value, transport, disabled } = deps(async () => ({ statusCode: 201 }));
    expect(await sendPush(target, payload, options, value)).toEqual({ id: "sub-1", status: "sent", statusCode: 201 });
    const request = transport.mock.calls[0][0];
    expect(JSON.parse(request.payload)).toEqual(payload);
    expect(request).toMatchObject({
      subscription: { endpoint: target.endpoint, keys: { p256dh: "BPk", auth: "au" } },
      ttlSeconds: 600,
      topic: "test",
      urgency: "high",
      vapid: value.vapid,
    });
    expect(disabled).toEqual([]);
  });

  it("disables a subscription the push service reports gone (404/410)", async () => {
    for (const statusCode of [404, 410]) {
      const { value, disabled } = deps(async () => ({ statusCode }));
      expect(await sendPush(target, payload, options, value)).toEqual({ id: "sub-1", status: "gone", statusCode });
      expect(disabled).toEqual(["sub-1"]);
    }
  });

  it("returns other failures as results without disabling or throwing", async () => {
    const rejected = deps(async () => ({ statusCode: 429 }));
    expect(await sendPush(target, payload, options, rejected.value)).toMatchObject({
      status: "failed",
      statusCode: 429,
    });
    const network = deps(async () => {
      throw new Error("ECONNRESET");
    });
    const results = await sendPushToAll([target, { ...target, id: "sub-2" }], payload, options, network.value);
    expect(results).toEqual([
      { id: "sub-1", status: "failed", error: "ECONNRESET" },
      { id: "sub-2", status: "failed", error: "ECONNRESET" },
    ]);
    expect([...rejected.disabled, ...network.disabled]).toEqual([]);
  });

  it("never sends to a non push-service endpoint or with a bad topic", async () => {
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    expect(
      await sendPush({ ...target, endpoint: "https://169.254.169.254/latest" }, payload, options, value),
    ).toMatchObject({ status: "failed" });
    await expect(sendPush(target, payload, { ...options, topic: "not a topic!" }, value)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("only ever links a notification to a path inside /app", async () => {
    for (const path of ["/app", "/app/today?x=1", "/app/notifications#top"]) expect(appNotificationPath(path)).toBe(path);
    const outside = ["/about", "/", "/application", "/auth", "https://evil.test/app", "//evil.test/app", "/app\\..\\about",
      "/app/../about", "/app/%2e%2e/about", "app/today", " /app", "/app\n", "", undefined];
    for (const path of outside) expect(appNotificationPath(path)).toBe("/app");
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    await sendPush(target, { ...payload, url: "/about" }, options, value);
    expect(JSON.parse(transport.mock.calls[0][0].payload).url).toBe("/app");
  });
});

describe("service worker", () => {
  // Runs public/sw.js in a sandbox with a fake worker scope.
  async function loadWorker() {
    const handlers: Record<string, (event: object) => void> = {};
    const opened: string[] = [];
    const shown: { title: string; options: { data: { url: string } } }[] = [];
    const scope = {
      location: { origin: "https://app.example" },
      navigator: {},
      addEventListener: (type: string, handler: (event: object) => void) => (handlers[type] = handler),
      skipWaiting: () => undefined,
      registration: { showNotification: async (title: string, options: never) => void shown.push({ title, options }) },
      clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
    };
    const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
    runInNewContext(source, { self: scope, URL, Promise });
    const run = async (type: string, event: object) => {
      let work: Promise<unknown> = Promise.resolve();
      handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
      await work;
    };
    return { handlers, opened, shown, run };
  }

  it("opens only /app paths on its own origin and has no fetch handler", async () => {
    const worker = await loadWorker();
    expect(Object.keys(worker.handlers).sort()).toEqual(
      ["activate", "install", "notificationclick", "push", "pushsubscriptionchange"].sort(),
    );
    const click = (url: unknown) =>
      worker.run("notificationclick", { notification: { close: () => undefined, data: { url } } });
    for (const url of ["/about", "https://evil.test/app", "//evil.test", "/app/../about", "https://app.example/"]) {
      await click(url);
    }
    await click("/app/today");
    expect(worker.opened).toEqual([...Array(5).fill("https://app.example/app"), "https://app.example/app/today"]);

    await worker.run("push", { data: { json: () => ({ title: "T", body: "B", url: "/research", tag: "t" }) } });
    expect(worker.shown[0].options.data.url).toBe("https://app.example/app");
  });
});

describe("sign-out on a phone with reminders", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  it("keeps the session when neither the server nor the browser can turn the device off", async () => {
    const signOut = vi.fn(async (input: { endpoint: string | null }) => (input ? { ok: false as const } : undefined));
    expect(await signOutDevice({ endpoint, signOut, unsubscribe: async () => false })).toBe("failed");
    expect(signOut.mock.calls).toEqual([[{ endpoint }]]);
    const throwing = async (): Promise<boolean> => {
      throw new Error("no service worker");
    };
    expect(await signOutDevice({ endpoint, signOut, unsubscribe: throwing })).toBe("failed");
  });

  it("falls back to dropping the browser subscription, then signs out", async () => {
    const signOut = vi.fn(async (input: { endpoint: string | null }) => (input.endpoint ? { ok: false as const } : undefined));
    const unsubscribe = vi.fn(async () => true);
    expect(await signOutDevice({ endpoint, signOut, unsubscribe })).toBe("signed-out");
    expect(signOut.mock.calls).toEqual([[{ endpoint }], [{ endpoint: null }]]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("signs out directly when the server disabled the device", async () => {
    const signOut = vi.fn(async () => undefined);
    const unsubscribe = vi.fn(async () => true);
    expect(await signOutDevice({ endpoint, signOut, unsubscribe })).toBe("signed-out");
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});

describe("device subscriptions", () => {
  it("accepts only browser push services and well-formed keys", () => {
    expect(isPushServiceEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.test/x", "https://localhost/x"]) {
      expect(isPushServiceEndpoint(bad)).toBe(false);
    }
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    expect(deviceSubscriptionSchema.safeParse({ endpoint: target.endpoint, keys }).success).toBe(true);
    expect(deviceSubscriptionSchema.safeParse({ endpoint: target.endpoint, keys: { ...keys, auth: "a b" } }).success).toBe(false);
  });

  it("stores one canonical spelling per endpoint and rejects fragments, userinfo and other ports", () => {
    const canonical = "https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y";
    for (const variant of [
      canonical,
      "https://FCM.GoogleAPIs.com/fcm/send/abc:APA91b-x_y",
      "https://fcm.googleapis.com:443/fcm/send/abc:APA91b-x_y",
      "https://fcm.googleapis.com/fcm/send/%61bc:APA91b%2Dx%5Fy",
      "https://fcm.googleapis.com/fcm/send/./abc:APA91b-x_y",
      `${canonical}?`,
    ]) {
      expect(canonicalEndpoint(variant)).toBe(canonical);
    }
    const wns = "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bab%3d";
    expect(canonicalEndpoint(wns)).toBe("https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2Bab%3D");
    for (const bad of [
      `${canonical}#other`,
      `${canonical}#`,
      "https://user@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com./fcm/send/abc",
      "https://fcm.googleapis.com/fcm/send/a%zz",
      "https://fcm.googleapis.com/fcm/send/a b",
    ]) {
      expect(canonicalEndpoint(bad)).toBeNull();
    }
    const parsed = deviceSubscriptionSchema.parse({
      endpoint: "https://FCM.googleapis.com:443/fcm/send/abc",
      keys: { p256dh: "BNc", auth: "tBH" },
    });
    expect(parsed.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc");
  });

  it("labels devices without storing the user agent", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
    expect(deviceLabel(iphone, 5)).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15", 5)).toBe("iPad · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0 Mobile Safari/537.36", 5)).toBe("Android · Chrome");
  });
});

describe("reminder readiness", () => {
  const facts = (overrides: Partial<DeviceFacts>): DeviceFacts => ({
    pushApi: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile",
    maxTouchPoints: 5,
    standalone: false,
    permission: "default",
    ...overrides,
  });
  const none = { subscribed: false, failed: false };
  const iphone = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) Mobile/15E148 Safari/604.1`;

  it("derives each designed state", () => {
    expect(reminderStatus(facts({}), none)).toBe("not-requested");
    expect(reminderStatus(facts({ permission: "granted" }), { subscribed: true, failed: false })).toBe("enabled");
    expect(reminderStatus(facts({ permission: "denied" }), none)).toBe("denied");
    expect(reminderStatus(facts({ permission: "granted" }), { subscribed: false, failed: true })).toBe("failed");
    expect(reminderStatus(facts({ pushApi: false }), none)).toBe("unsupported");
  });

  it("asks iPhone and iPad (as Mac with touch) to install first; old iOS is unsupported", () => {
    const ipadAsMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15";
    expect(reminderStatus(facts({ userAgent: iphone("17_4"), pushApi: false }), none)).toBe("needs-install");
    expect(reminderStatus(facts({ userAgent: ipadAsMac, pushApi: false }), none)).toBe("needs-install");
    expect(reminderStatus(facts({ userAgent: iphone("16_3"), pushApi: false }), none)).toBe("unsupported");
    expect(reminderStatus(facts({ userAgent: iphone("17_4"), standalone: true }), none)).toBe("not-requested");
    // A Mac without touch is a desktop browser.
    expect(reminderStatus(facts({ userAgent: ipadAsMac, maxTouchPoints: 0 }), none)).toBe("not-requested");
  });
});

describe("app files", () => {
  it("serves the manifest, worker and icons on the app host only", () => {
    const hosts = { appHost: "app.localhost:3000", publicHost: "www.localhost:3000" };
    expect(isAppFileOffAppHost({ host: "www.localhost:3000", pathname: "/sw.js" }, hosts)).toBe(true);
    expect(isAppFileOffAppHost({ host: "www.localhost:3000", pathname: "/app-icons/icon-192.png" }, hosts)).toBe(true);
    expect(isAppFileOffAppHost({ host: "app.localhost:3000", pathname: "/manifest.webmanifest" }, hosts)).toBe(false);
    expect(isAppFileOffAppHost({ host: "www.localhost:3000", pathname: "/logo.jpeg" }, hosts)).toBe(false);
    expect(isAppFileOffAppHost({ host: "localhost:3000", pathname: "/sw.js" }, {})).toBe(false);
  });
});
