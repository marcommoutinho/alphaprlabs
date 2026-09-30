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

  it("carries a reminder's job id when given one, and refuses anything else there", async () => {
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    const jobId = "0b6c8f5e-8f1c-4f47-9a51-5d8d3c1f2a10";
    await sendPush(target, { ...payload, jobId }, options, value);
    expect(JSON.parse(transport.mock.calls[0][0].payload)).toEqual({ ...payload, jobId });
    for (const notAnId of ["<script>", "job-due", "-".repeat(36), "0b6c8f5e-8f1c-4f47-9a51", `${jobId}-0`, ` ${jobId}`, "0b6c8f5e8f1c4f479a515d8d3c1f2a10"]) {
      await expect(sendPush(target, { ...payload, jobId: notAnId }, options, value)).rejects.toThrow(/UUID/);
    }
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
  it("a tap opens the pushed /app path, anything else opens /app", async () => {
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
    expect(Object.keys(handlers).sort()).toEqual(["activate", "fetch", "install", "notificationclick", "push", "pushsubscriptionchange"]);

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

  it("shows a repeat of the same reminder job silently, and alerts for a new one under the same tag", async () => {
    const handlers: Record<string, (event: object) => void> = {};
    type Shown = { title: string; tag?: string; renotify?: boolean; data: { url: string; jobId?: string } };
    let showing: Shown[] = [];
    const shown: Shown[] = [];
    const registration: Record<string, unknown> = {
      // A notification with the same tag replaces the one showing.
      showNotification: async (title: string, options: Omit<Shown, "title">) => {
        const notification = { title, ...options };
        shown.push(notification);
        showing = [...showing.filter((n) => !options.tag || n.tag !== options.tag), notification];
      },
      getNotifications: async ({ tag }: { tag?: string } = {}) => showing.filter((n) => !tag || n.tag === tag),
    };
    const self = {
      location: { origin: "https://app.example" },
      navigator: {},
      addEventListener: (type: string, handler: (event: object) => void) => (handlers[type] = handler),
      registration,
      clients: { matchAll: async () => [], openWindow: async () => undefined },
    };
    runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL, Promise });
    const push = async (body: object) => {
      let work: unknown;
      handlers.push({ data: { json: () => body }, waitUntil: (promise: unknown) => (work = promise) });
      await work;
      return shown.at(-1)!;
    };
    const tag = "dose:plan:phase:3";
    const heads = { title: "Planned soon", body: "B", url: "/app/today", tag };
    const [HEADS_UP, DUE, FOLLOW_UP] = ["5f0e4f5c-1b2a-4c3d-8e9f-0a1b2c3d4e5f", "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d", "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f"];

    // The heads-up alerts; the same job again (at least once) replaces it silently.
    expect(await push({ ...heads, jobId: HEADS_UP })).toMatchObject({ tag, renotify: true, data: { jobId: HEADS_UP } });
    expect(await push({ ...heads, jobId: HEADS_UP })).toMatchObject({ tag, renotify: false });
    // The due reminder (a new job, the same tag) replaces it and alerts; then the follow-up.
    expect(await push({ ...heads, title: "Due", jobId: DUE })).toMatchObject({ tag, renotify: true });
    expect(await push({ ...heads, title: "Due", jobId: DUE })).toMatchObject({ tag, renotify: false });
    expect(await push({ ...heads, title: "Final", jobId: FOLLOW_UP })).toMatchObject({ tag, renotify: true });
    // Once dismissed, a repeat shows (and alerts) again; another tag is its own.
    showing = [];
    expect(await push({ ...heads, title: "Final", jobId: FOLLOW_UP })).toMatchObject({ renotify: true });
    expect(await push({ ...heads, tag: "supplement:r:2026-09-30", jobId: FOLLOW_UP })).toMatchObject({ renotify: true });
    // Without a job id (the test notification), or a browser that can't list notifications: it alerts.
    expect(await push({ ...heads })).toMatchObject({ renotify: true });
    // Anything but a UUID there is no job id: it alerts every time, and is not kept.
    for (const notAnId of ["job-due", "-", "5f0e4f5c-1b2a-4c3d-8e9f", `${DUE}-x`, "-".repeat(36), 42]) {
      const first = await push({ ...heads, title: "Odd", jobId: notAnId });
      expect(first).toMatchObject({ renotify: true, data: { url: "/app/today" } });
      expect(first.data).not.toHaveProperty("jobId");
      expect(await push({ ...heads, title: "Odd", jobId: notAnId })).toMatchObject({ renotify: true });
    }
    delete registration.getNotifications;
    expect(await push({ ...heads, jobId: DUE })).toMatchObject({ renotify: true });
  });

  it("stores only the offline page, and serves it only when opening an app page finds no network", async () => {
    const handlers: Record<string, (event: object) => void> = {};
    const stored = new Map<string, string[]>([["alpha-offline-v0", ["/offline.html"]], ["someone-elses", ["/x"]]]);
    const deleted: string[] = [];
    const caches = {
      open: async (name: string) => ({ add: async (request: Request) => void stored.set(name, [new URL(request.url).pathname]) }),
      keys: async () => [...stored.keys()],
      delete: async (name: string) => void deleted.push(name),
      match: async (url: string, { cacheName }: { cacheName: string }) => (stored.get(cacheName)?.includes(url) ? "offline page" : undefined),
    };
    let network: "up" | "down" = "up";
    const fetched: string[] = [];
    const fetch = async (request: { url: string }) => {
      fetched.push(request.url);
      if (network === "down") throw new TypeError("Failed to fetch");
      return "from the network";
    };
    const self = {
      location: { origin: "https://app.example" },
      navigator: {},
      addEventListener: (type: string, handler: (event: object) => void) => (handlers[type] = handler),
      skipWaiting: async () => undefined,
      registration: { navigationPreload: { enable: async () => undefined } },
      clients: { claim: async () => undefined },
    };
    class FakeRequest {
      url: string;
      constructor(url: string) {
        this.url = new URL(url, "https://app.example").href;
      }
    }
    runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL, Promise, caches, fetch, Request: FakeRequest, Response: { error: () => "error" } });
    const wait = async (type: string) => {
      let work: unknown;
      handlers[type]({ waitUntil: (promise: unknown) => (work = promise) });
      await work;
    };
    await wait("install");
    await wait("activate");
    expect(stored.get("alpha-offline-v1")).toEqual(["/offline.html"]);
    // Only an older offline page goes; nothing else is touched.
    expect(deleted).toEqual(["alpha-offline-v0"]);

    const open = async (url: string, mode = "navigate", method = "GET") => {
      let answered: unknown = "not handled";
      handlers.fetch({ request: { url, mode, method }, preloadResponse: Promise.resolve(undefined), respondWith: (promise: unknown) => (answered = promise) });
      return await answered;
    };
    expect(await open("https://app.example/app/today")).toBe("from the network");
    network = "down";
    for (const url of ["https://app.example/app/today", "https://app.example/admin/people", "https://app.example/auth"])
      expect(await open(url), url).toBe("offline page");
    // Never: another origin, a public path, a request that isn't a page load (RSC, API, assets), or a POST.
    for (const [url, mode, method] of [
      ["https://www.example/app/today", "navigate", "GET"],
      ["https://app.example/about", "navigate", "GET"],
      ["https://app.example/application", "navigate", "GET"],
      ["https://app.example/app/today", "cors", "GET"],
      ["https://app.example/app/today/badge", "same-origin", "GET"],
      ["https://app.example/app/today", "navigate", "POST"],
    ] as const)
      expect(await open(url, mode, method), `${url} ${mode} ${method}`).toBe("not handled");
    // Nothing from the network is ever stored.
    expect(stored.get("alpha-offline-v1")).toEqual(["/offline.html"]);
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
      ["app.localhost:3000", "/manifest.webmanifest", false], ["www.localhost:3000", "/logo.jpeg", false],
      ["www.localhost:3000", "/offline.html", true], ["app.localhost:3000", "/offline.html", false]] as const;
    for (const [host, pathname, blocked] of cases) expect(isAppFileOffAppHost({ host, pathname }, hosts)).toBe(blocked);
    expect(isAppFileOffAppHost({ host: "localhost:3000", pathname: "/sw.js" }, {})).toBe(false);
  });
});
