import { describe, expect, it, vi } from "vitest";
import { isAppFileOffAppHost } from "@/lib/host-routing";
import { deviceSubscriptionSchema, isPushServiceEndpoint } from "@/lib/push/device";
import { deviceLabel, reminderStatus, type DeviceFacts } from "@/lib/push/readiness";
import { sendPush, sendPushToAll, type PushDeps, type TransportRequest } from "@/lib/push/send";

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

  it("never sends to a non push-service endpoint, off-site url or bad topic", async () => {
    const { value, transport } = deps(async () => ({ statusCode: 201 }));
    expect(
      await sendPush({ ...target, endpoint: "https://169.254.169.254/latest" }, payload, options, value),
    ).toMatchObject({ status: "failed" });
    await expect(sendPush(target, { ...payload, url: "https://evil.test" }, options, value)).rejects.toThrow();
    await expect(sendPush(target, { ...payload, url: "//evil.test" }, options, value)).rejects.toThrow();
    await expect(sendPush(target, payload, { ...options, topic: "not a topic!" }, value)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
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
