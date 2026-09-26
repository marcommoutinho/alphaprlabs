// S3.2: the research-side server actions ("Reminders on this phone") admit an
// admin for their OWN devices. The actions run against the real local
// Supabase as the signed-in person (RLS and database functions apply); only
// the request's cookie session is swapped for a signed-in client, and the
// push transport is recorded instead of reaching a real push service.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportRequest } from "@/lib/push/send";
import { appTestEnv, ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

Object.assign(process.env, appTestEnv(), { PUSH_TEST_ENABLED: "true" });

const acting = vi.hoisted(() => ({ client: null as unknown, pushed: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("@/lib/push/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/push/send")>();
  return {
    ...original,
    defaultPushDeps: () => ({
      vapid: { subject: "mailto:test@example.test", publicKey: "pub", privateKey: "priv" },
      transport: async (request: TransportRequest) => {
        acting.pushed.push(request.subscription.endpoint);
        return { statusCode: 201 };
      },
      disableGone: async () => {},
    }),
  };
});

const { saveDevice, sendTestNotification, turnOffDevice } = await import("@/app/(private)/app/notifications/actions");

const admin = { email: uniqueEmail("s32-act-admin"), name: "S32 Action Admin" };
const newAdmin = { email: uniqueEmail("s32-act-new-admin"), name: "S32 Unacknowledged Admin" };
const researcher = { email: uniqueEmail("s32-act-researcher"), name: "S32 Action Researcher" };
let adminId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
  await ensureAccount({ ...researcher, role: "researcher" });
});

beforeEach(() => {
  acting.pushed.length = 0;
});

const actAs = async (email: string) => {
  acting.client = await signedInClient(email);
};
const device = (mode: "turn_on" | "sync", deviceId = randomUUID()) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`,
  keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") },
  label: "iPhone",
  deviceId,
  mode,
});
const rowOf = async (endpoint: string) =>
  (await serviceClient().from("push_subscriptions").select("profile_id, disabled_reason").eq("endpoint", endpoint).single())
    .data;

describe("reminders actions for an admin", () => {
  it("an admin turns reminders on, sends a test notification to their own device only, and turns them off", async () => {
    // Another researcher's active device, which the admin's test must never reach.
    await actAs(researcher.email);
    const theirs = device("turn_on");
    expect(await saveDevice(theirs)).toEqual({ status: "saved" });

    await actAs(admin.email);
    const mine = device("turn_on");
    expect(await saveDevice(mine)).toEqual({ status: "saved" });
    expect(await rowOf(mine.endpoint)).toEqual({ profile_id: adminId, disabled_reason: null });

    expect(await sendTestNotification()).toEqual({ toast: "Sent to 1 device.", tone: "info" });
    expect(acting.pushed).toEqual([mine.endpoint]);

    expect(await turnOffDevice({ endpoint: mine.endpoint, deviceId: mine.deviceId })).toEqual({ ok: true });
    expect(await rowOf(mine.endpoint)).toEqual({ profile_id: adminId, disabled_reason: "turned_off" });
    expect(await saveDevice({ ...mine, mode: "sync" })).toEqual({ status: "refused_off" });
    expect(await sendTestNotification()).toEqual({ toast: "No device has reminders on.", tone: "error" });
    expect(acting.pushed).toEqual([mine.endpoint]);
    // The researcher's device is untouched throughout.
    expect(await rowOf(theirs.endpoint)).toMatchObject({ disabled_reason: null });
  });

  it("an admin who has not acknowledged is refused, like a researcher who has not", async () => {
    await actAs(newAdmin.email);
    const mine = device("turn_on");
    expect(await saveDevice(mine)).toEqual({ status: "failed" });
    expect(await rowOf(mine.endpoint)).toBeNull();
    expect(await sendTestNotification()).toMatchObject({ tone: "error", toast: "Sign in again to send a test notification." });
    expect(acting.pushed).toEqual([]);
  });
});
