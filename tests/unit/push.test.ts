import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { isAppFileOffAppHost } from "@/lib/host-routing";
import { canonicalEndpoint, deviceSubscriptionSchema } from "@/lib/push/device";
import { deviceLabel, reminderStatus, type DeviceFacts } from "@/lib/push/readiness";
import { appNotificationPath, sendPush, sendPushToAll, type PushDeps, type TransportRequest } from "@/lib/push/send";
import { signOutDevice } from "@/lib/push/sign-out";

const target = { id: "sub-1", endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "BPk", auth: "au" };
const payload = { title: "Alpha PR Labs", body: "Test", url: "/app/notifications", tag: "test", badge: 1 };
const options = { ttlSeconds: 600, topic: "test", urgency: "high" as const };

function deps(answer: (request: TransportRequest) => Promise<{ statusCode: number }>) {
  const disabled: string[] = [];
  const transport = vi.fn(answer);
  const vapid = { subject: "mailto:test@example.test", publicKey: "pub", privateKey: "priv" };
  const value: PushDeps = { vapid, transport, disableGone: async (id) => void disabled.push(id) };
  return { value, transport, disabled };
}

describe("push sending", () => {
  it("records acceptance as sent, disables gone subscriptions and returns other failures", async () => {
    const cases = [
      [201, { status: "sent", statusCode: 201 }, []],
      [404, { status: "gone", statusCode: 404 }, ["sub-1"]],
      [410, { status: "gone", statusCode: 410 }, ["sub-1"]],
      [429, { status: "failed", statusCode: 429 }, []],
    ] as const;
    for (const [statusCode, result, disabledIds] of cases) {
      const { value, disabled } = deps(async () => ({ statusCode }));
      expect(await sendPush(target, payload, options, value)).toMatchObject({ id: "sub-1", ...result });
      expect(disabled).toEqual(disabledIds);
    }
    const network = deps(async () => Promise.reject(new Error("ECONNRESET")));
    expect(await sendPushToAll([target, { ...target, id: "sub-2" }], payload, options, network.value)).toEqual([
      { id: "sub-1", status: "failed", error: "ECONNRESET" },
      { id: "sub-2", status: "failed", error: "ECONNRESET" },
    ]);
  });

  it("sends the payload shape with TTL, topic and urgency; refuses unknown endpoints and bad topics", async () => {
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    await sendPush(target, payload, options, value);
    const request = transport.mock.calls[0][0];
    expect(JSON.parse(request.payload)).toEqual(payload);
    expect(request).toMatchObject({ ttlSeconds: 600, topic: "test", urgency: "high", vapid: value.vapid });
    const other = { ...target, endpoint: "https://169.254.169.254/latest" };
    expect(await sendPush(other, payload, options, value)).toMatchObject({ status: "failed" });
    await expect(sendPush(target, payload, { ...options, topic: "not a topic!" }, value)).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("only ever links a notification to a path inside /app", async () => {
    for (const path of ["/app", "/app/today?x=1", "/app/notifications#top"]) expect(appNotificationPath(path)).toBe(path);
    const outside = ["/about", "/", "/application", "/auth", "https://evil.test/app", "//evil.test/app",
      "/app\\..\\about", "/app/../about", "/app/%2e%2e/about", "app/today", " /app", "/app\n", "", undefined];
    for (const path of outside) expect(appNotificationPath(path)).toBe("/app");
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    await sendPush(target, { ...payload, url: "/about" }, options, value);
    expect(JSON.parse(transport.mock.calls[0][0].payload).url).toBe("/app");
  });
});

describe("service worker (public/sw.js in a sandbox)", () => {
  it("has no fetch handler; a tap opens the pushed /app path, anything else opens /app", async () => {
    const handlers: Record<string, (event: object) => void> = {};
    const opened: string[] = [];
    const shown: { data: { url: string } }[] = [];
    const self = {
      location: { origin: "https://app.example" },
      navigator: {},
      addEventListener: (type: string, handler: (event: object) => void) => (handlers[type] = handler),
      registration: { showNotification: async (_title: string, options: never) => void shown.push(options) },
      clients: { matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
    };
    runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL, Promise });
    const run = async (type: string, event: object) => {
      let work: unknown;
      handlers[type]({ ...event, waitUntil: (promise: unknown) => (work = promise) });
      await work;
    };
    expect(Object.keys(handlers).sort()).toEqual(["activate", "install", "notificationclick", "push", "pushsubscriptionchange"]);

    // Round trip: push → notification data → tap.
    const pushed = ["/app/notifications", "/about", "https://evil.test/app", "//evil.test", "/app/../about"];
    for (const url of pushed) {
      await run("push", { data: { json: () => ({ title: "T", body: "B", url, tag: "t" }) } });
      await run("notificationclick", { notification: { close: () => undefined, data: shown.at(-1)!.data } });
    }
    // A tap on data that did not come from the push handler is checked again.
    await run("notificationclick", { notification: { close: () => undefined, data: { url: "https://app.example/" } } });
    expect(opened).toEqual(["https://app.example/app/notifications", ...Array(5).fill("https://app.example/app")]);
  });
});

describe("sign-out on a phone with reminders", () => {
  it("signs out only once the server marked the device off; else drops the subscription, retries once, else keeps the session", async () => {
    const device = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", deviceId: "0b8a4f3e-5d6c-4b7a-9e8f-1a2b3c4d5e6f" };
    const cases = [
      // server marks the device off (per call) | browser unsubscribe → outcome
      [[true], "unused", "signed-out"],
      [[false, true], true, "signed-out"],
      [[false, true], "throws", "signed-out"],
      [[false, false], true, "failed"], // never signed out without the off mark
    ] as const;
    for (const [server, unsubscribed, outcome] of cases) {
      const signOut = vi.fn(async () => ({ ok: server[signOut.mock.calls.length - 1] }));
      const unsubscribe = vi.fn(async () => {
        if (unsubscribed === "throws") throw new Error("no service worker");
        return unsubscribed === true;
      });
      expect(await signOutDevice({ ...device, signOut, unsubscribe })).toBe(outcome);
      // Every attempt, the retry included, carries the device id.
      expect(signOut.mock.calls).toEqual(server.map(() => [device]));
      expect(unsubscribe).toHaveBeenCalledTimes(server.length - 1);
    }
  });
});

describe("device subscriptions", () => {
  it("stores one canonical spelling per endpoint; rejects fragments, userinfo, other ports and other hosts", () => {
    const canonical = "https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y";
    const variants = ["https://FCM.GoogleAPIs.com/fcm/send/abc:APA91b-x_y", "https://fcm.googleapis.com:443/fcm/send/abc:APA91b-x_y",
      "https://fcm.googleapis.com/fcm/send/%61bc:APA91b%2Dx%5Fy", "https://fcm.googleapis.com/fcm/send/./abc:APA91b-x_y", `${canonical}?`];
    for (const variant of [canonical, ...variants]) expect(canonicalEndpoint(variant)).toBe(canonical);
    expect(canonicalEndpoint("https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bab%3d")).toBe(
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2Bab%3D",
    );
    expect(canonicalEndpoint("https://web.push.apple.com/QGx")).toBe("https://web.push.apple.com/QGx");
    const bad = [`${canonical}#other`, `${canonical}#`, "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x",
      "http://fcm.googleapis.com/x", "https://fcm.googleapis.com./x", "https://fcm.googleapis.com.evil.test/x",
      "https://localhost/x", "https://fcm.googleapis.com/a%zz", "https://fcm.googleapis.com/a b"];
    for (const endpoint of bad) expect(canonicalEndpoint(endpoint)).toBeNull();

    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" };
    const device = { keys, deviceId: "0b8a4f3e-5d6c-4b7a-9e8f-1a2b3c4d5e6f", mode: "sync" };
    expect(deviceSubscriptionSchema.parse({ ...device, endpoint: variants[1] }).endpoint).toBe(canonical);
    expect(deviceSubscriptionSchema.safeParse({ ...device, endpoint: canonical, keys: { ...keys, auth: "a b" } }).success).toBe(false);
    for (const bad of [{ mode: "force" }, { mode: undefined }, { deviceId: "not-a-uuid" }]) {
      expect(deviceSubscriptionSchema.safeParse({ ...device, endpoint: canonical, ...bad }).success).toBe(false);
    }
  });

  it("labels devices without storing the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Safari/604.1", 5)).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15", 5)).toBe("iPad · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0 Mobile Safari/537.36", 5)).toBe("Android · Chrome");
  });
});

describe("reminder readiness", () => {
  it("derives each designed state, including iPhone/iPad install-first and old iOS", () => {
    const android = "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile";
    const iphone = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) Mobile/15E148 Safari/604.1`;
    const ipadAsMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15";
    const cases: [Partial<DeviceFacts>, { subscribed?: boolean; failed?: boolean }, string][] = [
      [{}, {}, "not-requested"],
      [{ permission: "granted" }, { subscribed: true }, "enabled"],
      [{ permission: "denied" }, {}, "denied"],
      [{ permission: "granted" }, { failed: true }, "failed"],
      [{ pushApi: false }, {}, "unsupported"],
      [{ userAgent: iphone("17_4"), pushApi: false }, {}, "needs-install"],
      [{ userAgent: ipadAsMac, pushApi: false }, {}, "needs-install"],
      [{ userAgent: iphone("16_3"), pushApi: false }, {}, "unsupported"],
      [{ userAgent: iphone("17_4"), standalone: true }, {}, "not-requested"],
      [{ userAgent: ipadAsMac, maxTouchPoints: 0 }, {}, "not-requested"], // a Mac without touch is a desktop
    ];
    for (const [facts, device, status] of cases) {
      const all: DeviceFacts = { pushApi: true, userAgent: android, maxTouchPoints: 5, standalone: false, permission: "default", ...facts };
      expect(reminderStatus(all, { subscribed: false, failed: false, ...device }), JSON.stringify(facts)).toBe(status);
    }
  });

  it("serves the manifest, worker and icons on the app host only", () => {
    const hosts = { appHost: "app.localhost:3000", publicHost: "www.localhost:3000" };
    const cases = [["www.localhost:3000", "/sw.js", true], ["www.localhost:3000", "/app-icons/icon-192.png", true],
      ["app.localhost:3000", "/manifest.webmanifest", false], ["www.localhost:3000", "/logo.jpeg", false]] as const;
    for (const [host, pathname, blocked] of cases) expect(isAppFileOffAppHost({ host, pathname }, hosts)).toBe(blocked);
    expect(isAppFileOffAppHost({ host: "localhost:3000", pathname: "/sw.js" }, {})).toBe(false);
  });
});
