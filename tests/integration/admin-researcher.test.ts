// S3.2 "Admins are researchers" against the real local Supabase
// (npm run db:start): an admin uses the researcher functions for their OWN
// records, and the admin role is never a way past ownership. No mocked database.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ACKNOWLEDGEMENT_VERSION } from "@/lib/auth/paths";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

// Acknowledged accounts for the ownership tests; fresh unacknowledged ones for
// each test that starts before the acknowledgement.
const adminEmail = uniqueEmail("s32-admin");
const researcherEmail = uniqueEmail("s32-researcher");
const unacknowledged = {
  record: { admin: uniqueEmail("s32-record-admin"), researcher: uniqueEmail("s32-record-researcher") },
  gate: { admin: uniqueEmail("s32-gate-admin"), researcher: uniqueEmail("s32-gate-researcher") },
};
const ids: Record<string, string> = {};
let adminId: string;
let researcherId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ email: adminEmail, name: "S32 Admin", role: "admin" });
  researcherId = await ensureAccount({ email: researcherEmail, name: "S32 Researcher", role: "researcher" });
  for (const pair of Object.values(unacknowledged)) {
    for (const role of ["admin", "researcher"] as const) {
      ids[pair[role]] = await ensureAccount({ email: pair[role], name: `S32 New ${role}`, role, acknowledged: false });
    }
  }
});

type Keys = { p_p256dh: string; p_auth: string };
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
/** One browser's push subscription keys: a shared phone presents the same ones to every account. */
const keys = (): Keys => ({ p_p256dh: randomBytes(65).toString("base64url"), p_auth: randomBytes(16).toString("base64url") });
const save = (client: Client, url: string, mode = "turn_on", device = randomUUID(), subscriptionKeys = keys()) =>
  client.rpc("save_push_subscription", {
    p_endpoint: url,
    ...subscriptionKeys,
    p_device_label: "iPhone",
    p_device_id: device,
    p_mode: mode,
  });
const disable = (client: Client, url: string | undefined, reason: string, device = randomUUID()) =>
  client.rpc("disable_push_subscription", { p_endpoint: url, p_reason: reason, p_device_id: device });
const row = async (url: string) =>
  (
    await serviceClient()
      .from("push_subscriptions")
      .select("id, profile_id, disabled_reason, p256dh, auth, device_id, created_at")
      .eq("endpoint", url)
      .maybeSingle()
  ).data!;
const profile = async (id: string) =>
  (await serviceClient().from("profiles").select("role, acknowledgement_version, acknowledged_at").eq("id", id).single())
    .data!;

describe("admins are researchers: the caller's own records", () => {
  it("an admin records their own acknowledgement, and only their own", async () => {
    const { admin: adminAddress, researcher: researcherAddress } = unacknowledged.record;
    const [newAdminId, newResearcherId] = [ids[adminAddress], ids[researcherAddress]];
    const admin = await signedInClient(adminAddress);
    expect(await profile(newResearcherId)).toMatchObject({ acknowledged_at: null });
    expect((await admin.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data).toBe(true);
    expect(await profile(newAdminId)).toMatchObject({ role: "admin", acknowledgement_version: ACKNOWLEDGEMENT_VERSION });
    expect((await profile(newAdminId)).acknowledged_at).not.toBeNull();
    // The other researcher's acknowledgement is untouched and unreadable.
    expect(await profile(newResearcherId)).toMatchObject({ acknowledgement_version: null, acknowledged_at: null });
    expect((await admin.from("profiles").select("id, acknowledged_at").eq("id", newResearcherId)).data).toEqual([]);
    const forge = await admin
      .from("profiles")
      .update({ acknowledgement_version: "forged", acknowledged_at: new Date().toISOString() })
      .eq("id", newResearcherId);
    expect(forge.error).not.toBeNull();
    expect(await profile(newResearcherId)).toMatchObject({ acknowledgement_version: null });
    // Unchanged for researchers: they record their own too, and stay researchers.
    const researcher = await signedInClient(researcherAddress);
    expect((await researcher.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data).toBe(true);
    expect(await profile(newResearcherId)).toMatchObject({ role: "researcher", acknowledgement_version: ACKNOWLEDGEMENT_VERSION });
    // Anonymous callers still cannot.
    expect((await anonClient().rpc("record_acknowledgement", { p_version: "x" })).error).not.toBeNull();
  });

  it("an admin turns on, refreshes and turns off reminders on their own device", async () => {
    const admin = await signedInClient(adminEmail);
    const [url, device] = [endpoint(), randomUUID()];
    expect((await save(admin, url, "turn_on", device)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ profile_id: adminId, disabled_reason: null });
    expect((await admin.from("push_subscriptions").select("endpoint").eq("endpoint", url)).data).toEqual([
      { endpoint: url },
    ]);
    expect((await save(admin, url, "sync", device)).data).toBe("saved");

    // Turn off: disabled, the device is marked off, a pending sync is refused.
    expect((await disable(admin, url, "turned_off", device)).data).toBe(true);
    expect(await row(url)).toMatchObject({ disabled_reason: "turned_off" });
    expect((await save(admin, url, "sync", device)).data).toBe("refused_off");
    // Only an explicit turn on switches it back on; sign out disables it again.
    expect((await save(admin, url, "turn_on", device)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ disabled_reason: null });
    expect((await disable(admin, undefined, "signed_out", device)).data).toBe(true);
    expect(await row(url)).toMatchObject({ disabled_reason: "signed_out" });
    const { data: offMark } = await serviceClient()
      .from("push_device_off")
      .select("profile_id, reason")
      .eq("device_id", device);
    expect(offMark).toEqual([{ profile_id: adminId, reason: "signed_out" }]);
  });
});

describe("the admin role is never a way past ownership", () => {
  it("an admin cannot read, change, disable or refresh a researcher's subscription", async () => {
    const [admin, researcher] = await Promise.all([signedInClient(adminEmail), signedInClient(researcherEmail)]);
    const [url, device] = [endpoint(), randomUUID()];
    expect((await save(researcher, url, "turn_on", device)).data).toBe("saved");
    const before = await row(url);

    expect((await admin.from("push_subscriptions").select("id").eq("profile_id", researcherId)).data).toEqual([]);
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([]);
    expect((await admin.from("push_subscriptions").update({ profile_id: adminId }).eq("endpoint", url)).error).not.toBeNull();
    expect((await admin.from("push_subscriptions").delete().eq("endpoint", url)).error).not.toBeNull();
    const direct = await admin
      .from("push_subscriptions")
      .insert({ profile_id: researcherId, endpoint: endpoint(), p256dh: "x", auth: "y" });
    expect(direct.error).not.toBeNull();
    // Disabling by the researcher's endpoint, or even their device id, touches nothing of theirs.
    expect((await disable(admin, url, "turned_off")).data).toBe(false);
    expect((await disable(admin, url, "signed_out", device)).data).toBe(false);
    // A background sync cannot refresh or take over the researcher's row.
    expect((await save(admin, url, "sync")).data).toBe("refused_off");
    expect(await row(url)).toEqual(before);
    // The device-off marks stay unreachable through the API.
    expect((await admin.from("push_device_off").select("device_id")).error).not.toBeNull();
    const { data: marks } = await serviceClient()
      .from("push_device_off")
      .select("profile_id")
      .eq("device_id", device);
    expect(marks).toEqual([{ profile_id: adminId }]);
    // The researcher still sees their own active device.
    expect((await researcher.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([
      { id: before.id },
    ]);
  });

  it("a researcher cannot read or disable an admin's subscription, nor use admin functions", async () => {
    const [admin, researcher] = await Promise.all([signedInClient(adminEmail), signedInClient(researcherEmail)]);
    const url = endpoint();
    expect((await save(admin, url)).data).toBe("saved");
    expect((await researcher.from("push_subscriptions").select("id").eq("profile_id", adminId)).data).toEqual([]);
    expect((await disable(researcher, url, "turned_off")).data).toBe(false);
    expect(await row(url)).toMatchObject({ profile_id: adminId, disabled_reason: null });
    // Admin-only rules are unchanged: a researcher gains nothing.
    expect((await researcher.rpc("is_admin")).data).toBe(false);
    expect(await ok(researcher.from("invitations").select("id"))).toEqual([]);
    const invite = await researcher.rpc("invite_researcher", {
      p_name: "X",
      p_email: uniqueEmail("s32-nope"),
      p_token_hash: "0".repeat(64),
    });
    expect(invite.error).not.toBeNull();
    expect((await researcher.from("profiles").select("id")).data).toEqual([{ id: researcherId }]);
  });

  it("has_research_access is true for researchers and admins, and not callable anonymously", async () => {
    const [admin, researcher] = await Promise.all([signedInClient(adminEmail), signedInClient(researcherEmail)]);
    expect((await admin.rpc("has_research_access")).data).toBe(true);
    expect((await researcher.rpc("has_research_access")).data).toBe(true);
    expect((await admin.rpc("is_acknowledged_researcher")).data).toBe(true);
    expect((await researcher.rpc("is_acknowledged_researcher")).data).toBe(true);
    expect((await anonClient().rpc("has_research_access")).error).not.toBeNull();
    expect((await anonClient().rpc("is_acknowledged_researcher")).error).not.toBeNull();
  });
});

describe("the database enforces the acknowledgement for research writes", () => {
  it("an unacknowledged admin or researcher cannot turn on or sync reminders by direct RPC until they acknowledge", async () => {
    for (const role of ["admin", "researcher"] as const) {
      const email = unacknowledged.gate[role];
      const client = await signedInClient(email);
      const [url, device] = [endpoint(), randomUUID()];
      expect((await client.rpc("has_research_access")).data, role).toBe(true);
      expect((await client.rpc("is_acknowledged_researcher")).data, role).toBe(false);
      for (const mode of ["turn_on", "sync"]) {
        const refused = await save(client, url, mode, device);
        expect(refused, `${role} ${mode}`).toMatchObject({ error: null, data: null });
      }
      expect(await row(url), role).toBeNull();

      expect((await client.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data, role).toBe(true);
      expect((await save(client, url, "turn_on", device)).data, role).toBe("saved");
      expect((await save(client, url, "sync", device)).data, role).toBe("saved");
      expect(await row(url), role).toMatchObject({ profile_id: ids[email], disabled_reason: null });

      // Turning off and signing out never need the acknowledgement: with it
      // withdrawn, the caller still switches their own device off.
      await serviceClient().from("profiles").update({ acknowledgement_version: null, acknowledged_at: null }).eq("id", ids[email]);
      expect((await save(client, url, "turn_on", device)).data, role).toBeNull();
      expect((await disable(client, url, "signed_out", device)).data, role).toBe(true);
      expect(await row(url), role).toMatchObject({ profile_id: ids[email], disabled_reason: "signed_out" });
    }
  });
});

describe("turn on takes over another account's endpoint only from the same browser", () => {
  it("different keys are refused and the owner's row is untouched; the same keys (a shared phone) move it", async () => {
    const [admin, researcher] = await Promise.all([signedInClient(adminEmail), signedInClient(researcherEmail)]);
    const [url, phone] = [endpoint(), keys()];
    const [researcherDevice, adminDevice] = [randomUUID(), randomUUID()];
    expect((await save(researcher, url, "turn_on", researcherDevice, phone)).data).toBe("saved");
    const before = await row(url);

    // Knowing the endpoint URL is not enough: refused, whether the row is
    // active or turned off, and the admin's own off mark stays.
    await disable(admin, undefined, "turned_off", adminDevice);
    expect((await save(admin, url, "turn_on", adminDevice)).data).toBe("refused_off");
    expect((await save(admin, url, "turn_on", adminDevice, { ...phone, p_auth: keys().p_auth })).data).toBe("refused_off");
    expect(await row(url)).toEqual(before);
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([]);
    const { data: adminMark } = await serviceClient().from("push_device_off").select("reason").eq("device_id", adminDevice);
    expect(adminMark).toEqual([{ reason: "turned_off" }]);
    await disable(researcher, url, "turned_off", researcherDevice);
    expect((await save(admin, url, "turn_on", adminDevice)).data).toBe("refused_off");
    expect(await row(url)).toMatchObject({ profile_id: researcherId, disabled_reason: "turned_off", p256dh: phone.p_p256dh });

    // The same phone signed into the admin account: researcher → admin.
    expect((await save(admin, url, "turn_on", adminDevice, phone)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ id: before.id, profile_id: adminId, disabled_reason: null, device_id: adminDevice });
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([{ id: before.id }]);
    expect((await researcher.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([]);

    // ... and back, admin → researcher; a stranger's keys are refused the same way.
    expect((await save(researcher, url, "turn_on", researcherDevice)).data).toBe("refused_off");
    expect(await row(url)).toMatchObject({ profile_id: adminId, disabled_reason: null });
    expect((await save(researcher, url, "turn_on", researcherDevice, phone)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ id: before.id, profile_id: researcherId, disabled_reason: null });
    expect((await researcher.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([{ id: before.id }]);
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", url)).data).toEqual([]);

    // Re-registering one's own endpoint is unchanged: new keys are accepted.
    const renewed = keys();
    expect((await save(researcher, url, "turn_on", researcherDevice, renewed)).data).toBe("saved");
    expect(await row(url)).toMatchObject({ profile_id: researcherId, p256dh: renewed.p_p256dh, auth: renewed.p_auth });
  });
});
