// The research terms in the database (Marco, 2026-09-30), against the real
// local Supabase: the database's current version is the app's; an agreement
// to an earlier version passes no database gate; record_acknowledgement
// takes only the current version and records a new agreement over an old
// one, with its time. No mocked database.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ACKNOWLEDGEMENT_VERSION } from "@/lib/auth/paths";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

const OLD_VERSION = "2026-09-placeholder";
const accounts = {
  researcher: uniqueEmail("terms-old-researcher"),
  admin: uniqueEmail("terms-old-admin"),
  wrong: uniqueEmail("terms-wrong-version"),
};
const ids: Record<string, string> = {};

beforeAll(async () => {
  ids.researcher = await ensureAccount({ email: accounts.researcher, name: "Terms Old Researcher", role: "researcher", termsVersion: OLD_VERSION });
  ids.admin = await ensureAccount({ email: accounts.admin, name: "Terms Old Admin", role: "admin", termsVersion: OLD_VERSION });
  ids.wrong = await ensureAccount({ email: accounts.wrong, name: "Terms Wrong Version", role: "researcher", termsVersion: OLD_VERSION });
});

type Client = Awaited<ReturnType<typeof signedInClient>>;
const stored = async (id: string) =>
  (await serviceClient().from("profiles").select("acknowledgement_version, acknowledged_at").eq("id", id).single()).data!;
/** A research write gated on the terms in the database: null when refused. */
const turnOn = (client: Client) =>
  client.rpc("save_push_subscription", {
    p_endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`,
    p_p256dh: randomBytes(65).toString("base64url"),
    p_auth: randomBytes(16).toString("base64url"),
    p_device_label: "iPhone",
    p_device_id: randomUUID(),
    p_mode: "turn_on",
  });

describe("the research terms version", () => {
  it("is the same in the database and the app", async () => {
    const client = await signedInClient(accounts.researcher);
    expect((await client.rpc("current_terms_version")).data).toBe(ACKNOWLEDGEMENT_VERSION);
  });
});

describe("an agreement to an earlier version", () => {
  for (const role of ["researcher", "admin"] as const) {
    it(`passes no database gate for a ${role} until they agree again, which stores the new version and time`, async () => {
      const client = await signedInClient(accounts[role]);
      const before = await stored(ids[role]);
      expect(before.acknowledgement_version).toBe(OLD_VERSION);
      expect((await client.rpc("is_acknowledged_researcher")).data).toBe(false);
      expect(await turnOn(client)).toMatchObject({ error: null, data: null });

      // Agreeing again to the earlier version is refused, and nothing changes.
      const refused = await client.rpc("record_acknowledgement", { p_version: OLD_VERSION });
      expect(refused.error?.code).toBe("22023");
      expect(await stored(ids[role])).toEqual(before);

      // Agreeing to the current version replaces the old agreement.
      expect((await client.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data).toBe(true);
      const after = await stored(ids[role]);
      expect(after.acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
      expect(Date.parse(after.acknowledged_at!)).toBeGreaterThan(Date.parse(before.acknowledged_at!));
      expect((await client.rpc("is_acknowledged_researcher")).data).toBe(true);
      expect((await turnOn(client)).data).toBe("saved");

      // Agreeing again to the current version is accepted too (a new time).
      expect((await client.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data).toBe(true);
      expect((await stored(ids[role])).acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    });
  }

  it("any version but the current one is refused, and a table write can't forge one", async () => {
    const client = await signedInClient(accounts.wrong);
    const before = await stored(ids.wrong);
    for (const version of ["", "x", `${ACKNOWLEDGEMENT_VERSION} `, "2026-10-01"]) {
      expect((await client.rpc("record_acknowledgement", { p_version: version })).error?.code, version).toBe("22023");
    }
    const forge = await client.from("profiles").update({ acknowledgement_version: ACKNOWLEDGEMENT_VERSION }).eq("id", ids.wrong);
    expect(forge.error).not.toBeNull();
    expect(await stored(ids.wrong)).toEqual(before);
    expect((await client.rpc("is_acknowledged_researcher")).data).toBe(false);
  });
});
