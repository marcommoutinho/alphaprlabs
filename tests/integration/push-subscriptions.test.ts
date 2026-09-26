// Device subscriptions against the real local Supabase (npm run db:start):
// owner-bound writes, owner-only reads, shared phones, turning off, and
// background syncs that can never switch a device back on.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, appTestEnv, ensureAccount, serviceClient, signedInClient, uniqueEmail, visibleRows } from "../support/local-supabase";

Object.assign(process.env, appTestEnv());
const { disableGoneSubscription } = await import("@/lib/push/send");
const { canonicalEndpoint } = await import("@/lib/push/device");

const [emailA, emailB, adminEmail] = [uniqueEmail("push-a"), uniqueEmail("push-b"), uniqueEmail("push-admin")];
let idA: string;
let idB: string;

beforeAll(async () => {
  idA = await ensureAccount({ email: emailA, name: "Push A", role: "researcher" });
  idB = await ensureAccount({ email: emailB, name: "Push B", role: "researcher" });
  await ensureAccount({ email: adminEmail, name: "Push Admin", role: "admin" });
});

type Client = Awaited<ReturnType<typeof signedInClient>>;
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
const keys = () => ({ p_p256dh: randomBytes(65).toString("base64url"), p_auth: randomBytes(16).toString("base64url") });
const save = (client: Client, url: string, mode = "turn_on", device = randomUUID(), subscriptionKeys = keys()) =>
  client.rpc("save_push_subscription", {
    p_endpoint: url,
    ...subscriptionKeys,
    p_device_label: "Android · Chrome",
    p_device_id: device,
    p_mode: mode,
  });
const disable = (client: Client, url: string | undefined, reason: string, device = randomUUID()) =>
  client.rpc("disable_push_subscription", { p_endpoint: url, p_reason: reason, p_device_id: device });
const row = async (url: string) =>
  (await serviceClient().from("push_subscriptions").select("id, profile_id, disabled_reason, last_seen_at").eq("endpoint", url).single()).data!;

describe("push subscriptions", () => {
  it("only the owner reads a device; other researchers, admins and anon cannot read or write it", async () => {
    const [a, b, admin] = await Promise.all([signedInClient(emailA), signedInClient(emailB), signedInClient(adminEmail)]);
    const url = endpoint();
    expect((await save(a, url)).error).toBeNull();
    expect((await a.from("push_subscriptions").select("endpoint")).data).toEqual([{ endpoint: url }]);
    for (const other of [b, admin, anonClient()]) {
      expect(await visibleRows(other.from("push_subscriptions").select("id"))).toHaveLength(0);
      expect((await other.from("push_subscriptions").update({ profile_id: idB }).eq("endpoint", url)).error).not.toBeNull();
      expect((await other.from("push_subscriptions").delete().eq("endpoint", url)).error).not.toBeNull();
      expect((await disable(other, url, "turned_off")).data ?? false).toBe(false);
    }
    // No direct writes, even by the owner; anon cannot register devices. (Admins
    // register their own devices: tests/integration/admin-researcher.test.ts.)
    const direct = await a.from("push_subscriptions").insert({ profile_id: idA, endpoint: endpoint(), p256dh: "x", auth: "y" });
    expect(direct.error).not.toBeNull();
    expect((await save(anonClient(), endpoint())).error).not.toBeNull();
    expect(await row(url)).toMatchObject({ profile_id: idA, disabled_reason: null });
  });

  it("a shared phone moves to the account that registers it, under any spelling of its endpoint", async () => {
    const [a, b] = await Promise.all([signedInClient(emailA), signedInClient(emailB)]);
    // One browser: the same subscription keys whichever account is signed in.
    const [url, phone] = [endpoint(), keys()];
    await save(a, url, "turn_on", randomUUID(), phone);
    const first = await row(url);
    await save(a, url, "turn_on", randomUUID(), phone);
    expect(new Date((await row(url)).last_seen_at) > new Date(first.last_seen_at)).toBe(true);

    const token = url.slice(url.lastIndexOf("/") + 1);
    const variants = [`${url}#b`, `${url}#`, url.replace("fcm.", "FCM."), url.replace(".com", ".com:443"),
      url.replace(`/${token}`, `/%${token.charCodeAt(0).toString(16)}${token.slice(1)}`), url.replace("https://", "https://b@"), `${url}?`];
    for (const variant of variants) {
      // The database refuses a non-canonical spelling, even by direct RPC ...
      expect((await save(b, variant, "turn_on", randomUUID(), phone)).error, variant).not.toBeNull();
      // ... and the app maps each equivalent spelling to the one canonical URL.
      expect([null, url]).toContain(canonicalEndpoint(variant));
    }
    const { data: rows } = await serviceClient().from("push_subscriptions").select("profile_id").like("endpoint", `%${token}%`);
    expect(rows).toEqual([{ profile_id: idA }]);

    // Another browser's keys can't take it (tests/integration/admin-researcher.test.ts); the phone's can.
    expect((await save(b, canonicalEndpoint(variants[2])!)).data).toBe("refused_off");
    expect((await save(b, canonicalEndpoint(variants[2])!, "turn_on", randomUUID(), phone)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ id: first.id, profile_id: idB, disabled_reason: null });
    expect((await a.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([]);
  });

  it("turning off, signing out and a gone endpoint disable the row; registering again re-enables it", async () => {
    const a = await signedInClient(emailA);
    const url = endpoint();
    for (const reason of ["turned_off", "signed_out"]) {
      await save(a, url);
      expect((await disable(a, url, reason)).data).toBe(true);
      expect(await row(url)).toMatchObject({ disabled_reason: reason });
    }
    await save(a, url);
    expect(await row(url)).toMatchObject({ disabled_reason: null });
    await disableGoneSubscription((await row(url)).id);
    expect(await row(url)).toMatchObject({ disabled_reason: "gone" });
    // The owner cannot mark rows with other reasons.
    expect((await disable(a, url, "gone")).error).not.toBeNull();
  });

  it("a background sync never switches a device back on; only an explicit turn on does", async () => {
    const a = await signedInClient(emailA);
    const [url, device] = [endpoint(), randomUUID()];
    expect((await save(a, url, "turn_on", device)).data).toBe("saved");
    expect((await save(a, url, "sync", device)).data).toBe("saved");

    // Turned off in one tab: a sync still pending in another is refused, from any device id.
    await disable(a, url, "turned_off", device);
    for (const id of [device, randomUUID()]) expect((await save(a, url, "sync", id)).data).toBe("refused_off");
    expect(await row(url)).toMatchObject({ disabled_reason: "turned_off" });
    expect((await save(a, url, "turn_on", device)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ disabled_reason: null });

    // Signed out with the endpoint unknown: the device id alone disables its
    // rows and refuses a sync under a new endpoint (the browser resubscribed).
    expect((await disable(a, undefined, "signed_out", device)).data).toBe(true);
    expect(await row(url)).toMatchObject({ disabled_reason: "signed_out" });
    const rotated = endpoint();
    expect((await save(a, rotated, "sync", device)).data).toBe("refused_off");
    expect((await serviceClient().from("push_subscriptions").select("id").eq("endpoint", rotated)).data).toEqual([]);
    // Another browser of the same account still registers new endpoints by sync.
    expect((await save(a, endpoint(), "sync", randomUUID())).data).toBe("saved");
    expect((await save(a, rotated, "turn_on", device)).data).toBe("saved");
    expect((await save(a, rotated, "sync", device)).data).toBe("saved");
  });

  it("a sync can't take another account's endpoint, and nothing bypasses the mode", async () => {
    const [a, b] = await Promise.all([signedInClient(emailA), signedInClient(emailB)]);
    const url = endpoint();
    await save(a, url);
    expect((await save(b, url, "sync")).data).toBe("refused_off");
    expect(await row(url)).toMatchObject({ profile_id: idA, disabled_reason: null });

    const device = randomUUID();
    await disable(a, url, "turned_off", device);
    const bypasses = [
      { p_endpoint: url, ...keys(), p_device_label: "" }, // the old signature
      { p_endpoint: url, ...keys(), p_device_label: "", p_device_id: device }, // no mode
      { p_endpoint: url, ...keys(), p_device_label: "", p_device_id: device, p_mode: "force" },
      { p_endpoint: url, ...keys(), p_device_label: "", p_mode: "sync" }, // no device id
    ];
    for (const args of bypasses) expect((await a.rpc("save_push_subscription", args as never)).error).not.toBeNull();
    // A disable must mark a device off: the old payload and a null device id are refused.
    const other = endpoint();
    await save(a, other);
    for (const args of [{ p_endpoint: other, p_reason: "signed_out" }, { p_endpoint: other, p_reason: "signed_out", p_device_id: null }]) {
      expect((await a.rpc("disable_push_subscription", args as never)).error).not.toBeNull();
    }
    expect(await row(other)).toMatchObject({ disabled_reason: null });
    // The off mark is not reachable through the API.
    expect((await a.from("push_device_off").delete().eq("device_id", device)).error).not.toBeNull();
    expect((await a.from("push_device_off").select("device_id")).error).not.toBeNull();
    expect(await row(url)).toMatchObject({ disabled_reason: "turned_off" });
    expect((await serviceClient().from("push_device_off").select("reason").eq("device_id", device)).data).toEqual([{ reason: "turned_off" }]);
  });
});
