// V4 R8 Me against the real local Supabase, through PostgREST as each
// signed-in person, exactly as the app reads and writes: preferences
// (20260928140000_me_preferences.sql) default to 100-unit / kg / System,
// are read and written by their owner only, validated, and saved
// idempotently by request key; the keyed share / stop behind R17 replays
// instead of sharing twice; and what a researcher reads on Me never names
// an admin.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readSessionPerson } from "@/lib/auth/session";
import { getPreferences, preferencesRequestHash, savePreferences } from "@/lib/preferences/service";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/rules";
import { listShareHistory, shareWithTeam, stopSharing } from "@/lib/support/service";
import { ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

const people = {
  riley: { email: uniqueEmail("v4-riley"), name: "Riley Prefs", role: "researcher" },
  sam: { email: uniqueEmail("v4-sam"), name: "Sam Other", role: "researcher" },
  una: { email: uniqueEmail("v4-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  ada: { email: uniqueEmail("v4-ada"), name: `Ada Adminname ${randomUUID().slice(0, 6)}`, role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;

beforeAll(async () => {
  for (const [name, person] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[name] = await ensureAccount(person);
    db[name] = await signedInClient(person.email);
  }
});

const save = (who: Name, key: string, args: { p_default_syringe?: number; p_weight_unit?: string; p_appearance?: string }, hash = "a".repeat(64)) =>
  db[who].rpc("save_account_preferences", { p_request_key: key, p_request_hash: hash, ...args });

describe("account preferences", () => {
  it("default to a 100-unit syringe, kg and the device's appearance until saved", async () => {
    expect(await getPreferences(db.sam, id.sam)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({ defaultSyringe: 100, weightUnit: "kg", appearance: null });
    // No row is created by reading.
    expect(await ok(serviceClient().from("account_preferences").select("owner_id").eq("owner_id", id.sam))).toEqual([]);
  });

  it("save a patch at a time, keeping the other choices", async () => {
    const first = await savePreferences(db.riley, randomUUID(), { defaultSyringe: 30 });
    expect(first).toEqual({ kind: "saved", replayed: false, preferences: { defaultSyringe: 30, weightUnit: "kg", appearance: null } });
    await savePreferences(db.riley, randomUUID(), { weightUnit: "lb" });
    await savePreferences(db.riley, randomUUID(), { appearance: "dark" });
    expect(await getPreferences(db.riley, id.riley)).toEqual({ defaultSyringe: 30, weightUnit: "lb", appearance: "dark" });
    await savePreferences(db.riley, randomUUID(), { appearance: "system" });
    expect((await getPreferences(db.riley, id.riley)).appearance).toBe("system");
  });

  it("replay the same request key and patch without writing twice; refuse a key reused for another patch or account", async () => {
    const key = randomUUID();
    const patch = { defaultSyringe: 50 } as const;
    expect(await savePreferences(db.riley, key, patch)).toMatchObject({ kind: "saved", replayed: false });
    // Meanwhile another save changes the syringe; the retry replays its first answer and changes nothing.
    await savePreferences(db.riley, randomUUID(), { defaultSyringe: 100 });
    expect(await savePreferences(db.riley, key, patch)).toEqual({
      kind: "saved",
      replayed: true,
      preferences: { defaultSyringe: 50, weightUnit: "lb", appearance: "system" },
    });
    expect((await getPreferences(db.riley, id.riley)).defaultSyringe).toBe(100);
    // The same key with another patch, or from another account, is refused.
    expect(await sqlState(save("riley", key, { p_default_syringe: 30 }, preferencesRequestHash({ defaultSyringe: 30 })))).toBe("22023");
    expect(await sqlState(save("sam", key, { p_default_syringe: 50 }, preferencesRequestHash(patch)))).toBe("22023");
  });

  it("validate every value and refuse an empty patch", async () => {
    for (const args of [
      { p_default_syringe: 40 },
      { p_default_syringe: 0 },
      { p_weight_unit: "st" },
      { p_weight_unit: "KG" },
      { p_appearance: "sepia" },
      {},
    ]) {
      expect(await sqlState(save("sam", randomUUID(), args)), JSON.stringify(args)).toBe("22023");
    }
    // A malformed request hash is refused too.
    expect(await sqlState(save("sam", randomUUID(), { p_weight_unit: "lb" }, "not-a-hash"))).toBe("22023");
    expect(await getPreferences(db.sam, id.sam)).toEqual(DEFAULT_PREFERENCES);
  });

  it("are the owner's only: nobody else reads them, and no one writes the table directly", async () => {
    await savePreferences(db.riley, randomUUID(), { weightUnit: "lb" });
    // Another researcher and an admin read nothing of Riley's.
    for (const who of ["sam", "ada"] as const) {
      expect(await ok(db[who].from("account_preferences").select("*").eq("owner_id", id.riley)), who).toEqual([]);
    }
    // Direct writes are refused, even to one's own row (only the function writes).
    expect(await sqlState(db.riley.from("account_preferences").update({ weight_unit: "kg" }).eq("owner_id", id.riley))).toBe("42501");
    expect(
      await sqlState(db.sam.from("account_preferences").insert({ owner_id: id.sam, default_syringe: 30, weight_unit: "kg" })),
    ).toBe("42501");
    expect(await sqlState(db.riley.from("account_preferences").delete().eq("owner_id", id.riley))).toBe("42501");
    // The request log is not readable at all.
    expect(await sqlState(db.riley.from("account_preference_requests").select("*"))).toBe("42501");
    expect((await getPreferences(db.riley, id.riley)).weightUnit).toBe("lb");
  });

  it("are refused before the disclaimer is acknowledged", async () => {
    expect(await sqlState(save("una", randomUUID(), { p_weight_unit: "lb" }))).toBe("42501");
  });

  it("come with the session person (the profile read embeds them)", async () => {
    expect((await readSessionPerson(db.riley, id.riley))?.preferences.weightUnit).toBe("lb");
    expect((await readSessionPerson(db.sam, id.sam))?.preferences).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("R17 sharing with request keys", () => {
  it("shares once per key: a retry replays, even after stopping meanwhile", async () => {
    const shareKey = randomUUID();
    expect(await shareWithTeam(db.sam, shareKey)).toEqual({ kind: "shared", replayed: false });
    expect(await shareWithTeam(db.sam, shareKey)).toEqual({ kind: "shared", replayed: true });
    const stopKey = randomUUID();
    expect(await stopSharing(db.sam, stopKey)).toEqual({ kind: "stopped", replayed: false });
    // The share's retry arriving late does not share again.
    expect(await shareWithTeam(db.sam, shareKey)).toEqual({ kind: "shared", replayed: true });
    expect(await stopSharing(db.sam, stopKey)).toEqual({ kind: "stopped", replayed: true });
    const history = await listShareHistory(db.sam, id.sam);
    expect(history).toHaveLength(1);
    expect(history[0].stoppedAt).not.toBeNull();
    // A new stop with nothing shared says so.
    expect(await stopSharing(db.sam, randomUUID())).toEqual({ kind: "not_sharing", replayed: false });
  });

  it("refuses a key used for the other kind or by another account, and sharing before the disclaimer", async () => {
    const key = randomUUID();
    await shareWithTeam(db.riley, key);
    expect(await sqlState(db.riley.rpc("stop_sharing_with_team", { p_request_key: key }))).toBe("22023");
    expect(await sqlState(db.sam.rpc("share_with_team", { p_request_key: key }))).toBe("22023");
    expect(await sqlState(db.una.rpc("share_with_team", { p_request_key: randomUUID() }))).toBe("42501");
    // The claims table is not readable.
    expect(await sqlState(db.riley.from("support_share_requests").select("*"))).toBe("42501");
    await stopSharing(db.riley, randomUUID());
  });

  it("never gives a researcher an admin's name on Me", async () => {
    await shareWithTeam(db.riley, randomUUID());
    const reads = [
      await ok(db.riley.from("support_shares").select("*").eq("researcher_id", id.riley)),
      await listShareHistory(db.riley, id.riley),
      await ok(db.riley.from("profiles").select("*")),
      await ok(db.riley.from("account_preferences").select("*")),
    ];
    const text = JSON.stringify(reads);
    expect(text).not.toContain(people.ada.name);
    expect(text).not.toContain(people.ada.email);
    expect(text).not.toContain(id.ada);
    await stopSharing(db.riley, randomUUID());
  });
});
