// Device subscriptions against the real local Supabase (npm run db:start):
// owner-bound writes, owner-only reads, shared phones and turning off.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  appTestEnv,
  ensureAccount,
  serviceClient,
  signedInClient,
  uniqueEmail,
} from "../support/local-supabase";

Object.assign(process.env, appTestEnv());
const { disableGoneSubscription } = await import("@/lib/push/send");

const researcherA = { email: uniqueEmail("push-a"), name: "Push A" };
const researcherB = { email: uniqueEmail("push-b"), name: "Push B" };
const admin = { email: uniqueEmail("push-admin"), name: "Push Admin" };
let idA: string;
let idB: string;

beforeAll(async () => {
  idA = await ensureAccount({ ...researcherA, role: "researcher" });
  idB = await ensureAccount({ ...researcherB, role: "researcher" });
  await ensureAccount({ ...admin, role: "admin" });
});

type Client = Awaited<ReturnType<typeof signedInClient>>;
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
const save = (client: Client, url: string) =>
  client.rpc("save_push_subscription", {
    p_endpoint: url,
    p_p256dh: randomBytes(65).toString("base64url"),
    p_auth: randomBytes(16).toString("base64url"),
    p_device_label: "Android · Chrome",
  });
const row = async (url: string) =>
  (
    await serviceClient()
      .from("push_subscriptions")
      .select("id, profile_id, disabled_at, disabled_reason, last_seen_at")
      .eq("endpoint", url)
      .single()
  ).data!;

describe("push subscriptions", () => {
  it("only the owner reads a device; other researchers, admins and anon cannot read or write it", async () => {
    const a = await signedInClient(researcherA.email);
    const b = await signedInClient(researcherB.email);
    const url = endpoint();
    expect((await save(a, url)).error).toBeNull();

    expect((await a.from("push_subscriptions").select("endpoint")).data).toEqual([{ endpoint: url }]);
    for (const other of [b, await signedInClient(admin.email), anonClient()]) {
      expect((await other.from("push_subscriptions").select("id")).data ?? []).toHaveLength(0);
      expect((await other.from("push_subscriptions").update({ profile_id: idB }).eq("endpoint", url)).error).not.toBeNull();
      expect((await other.from("push_subscriptions").delete().eq("endpoint", url)).error).not.toBeNull();
      // Turning off someone else's device changes nothing.
      const off = await other.rpc("disable_push_subscription", { p_endpoint: url, p_reason: "turned_off" });
      expect(off.data ?? false).toBe(false);
    }
    // No direct writes, even by the owner.
    const direct = await a.from("push_subscriptions").insert({ profile_id: idA, endpoint: endpoint(), p256dh: "x", auth: "y" });
    expect(direct.error).not.toBeNull();
    expect(await row(url)).toMatchObject({ profile_id: idA, disabled_at: null });

    // Anonymous callers and admins cannot register devices.
    expect((await save(anonClient(), endpoint())).error).not.toBeNull();
    expect((await save(await signedInClient(admin.email), endpoint())).data).toBeNull();
  });

  it("re-registering refreshes last_seen; a shared phone moves to the account that registers it", async () => {
    const a = await signedInClient(researcherA.email);
    const b = await signedInClient(researcherB.email);
    const url = endpoint();
    await save(a, url);
    const first = await row(url);
    await save(a, url);
    const again = await row(url);
    expect(again.id).toBe(first.id);
    expect(new Date(again.last_seen_at).getTime()).toBeGreaterThan(new Date(first.last_seen_at).getTime());

    expect((await save(b, url)).error).toBeNull();
    expect(await row(url)).toMatchObject({ id: first.id, profile_id: idB, disabled_at: null });
    expect((await a.from("push_subscriptions").select("endpoint").eq("endpoint", url)).data).toEqual([]);
    expect((await b.from("push_subscriptions").select("endpoint").eq("endpoint", url)).data).toEqual([{ endpoint: url }]);
  });

  it("turning off, signing out and a gone endpoint disable the row; registering again re-enables it", async () => {
    const a = await signedInClient(researcherA.email);
    const url = endpoint();
    await save(a, url);
    expect((await a.rpc("disable_push_subscription", { p_endpoint: url, p_reason: "turned_off" })).data).toBe(true);
    expect(await row(url)).toMatchObject({ disabled_reason: "turned_off", disabled_at: expect.any(String) });

    await save(a, url);
    expect(await row(url)).toMatchObject({ disabled_reason: null, disabled_at: null });
    expect((await a.rpc("disable_push_subscription", { p_endpoint: url, p_reason: "signed_out" })).data).toBe(true);
    expect(await row(url)).toMatchObject({ disabled_reason: "signed_out" });

    await save(a, url);
    await disableGoneSubscription((await row(url)).id);
    expect(await row(url)).toMatchObject({ disabled_reason: "gone" });

    // The owner cannot mark rows with other reasons.
    expect((await a.rpc("disable_push_subscription", { p_endpoint: url, p_reason: "gone" })).error).not.toBeNull();
  });
});
