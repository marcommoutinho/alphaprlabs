// The research terms in the database (Marco, 2026-09-30), against the real
// local Supabase: the database's current version is the app's; an agreement
// to an earlier version passes no database gate; record_acknowledgement
// takes only the current version and records a new agreement over an old
// one, with its time. An owner on an earlier version reads none of its own
// research records and gets no reminders until it agrees again; a team share
// stays readable by admins, whatever their own version. No mocked database.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ACKNOWLEDGEMENT_VERSION } from "@/lib/auth/paths";
import { checkInDay } from "@/lib/progress/rules";
import { saveCheckIn } from "@/lib/progress/service";
import { listDueSupplements } from "@/lib/supplements/service";
import { createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

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

// ── Own reads and reminders need the current terms; a team share doesn't ──────

describe("an owner on an earlier version", () => {
  const people = {
    owner: uniqueEmail("terms-reads-owner"),
    admin: uniqueEmail("terms-reads-admin"),
    outdatedAdmin: uniqueEmail("terms-reads-old-admin"),
  };
  const who = {} as Record<keyof typeof people, { id: string; db: Client }>;
  let cycleId = "";
  let planId = "";
  let routineId = "";
  let endpoint = "";

  /** How many of each kind of its own record the owner's session reads. */
  const ownReads = async () => {
    const db = who.owner.db;
    const count = async (call: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      const { data, error } = await call;
      if (error) throw new Error(`read failed: ${JSON.stringify(error)}`);
      return data?.length ?? 0;
    };
    return {
      cycles: await count(db.from("cycles").select("id").eq("id", cycleId)),
      plans: await count(db.from("cycle_plans").select("id").eq("cycle_id", cycleId)),
      doses: await count(db.from("dose_records").select("id").eq("cycle_id", cycleId)),
      checkIns: await count(db.from("progress_check_ins").select("id").eq("owner_id", who.owner.id)),
      routines: await count(db.from("supplement_routines").select("id").eq("id", routineId)),
    };
  };
  const ALL = { cycles: 1, plans: 1, doses: 1, checkIns: 1, routines: 1 };
  const NONE = { cycles: 0, plans: 0, doses: 0, checkIns: 0, routines: 0 };

  /** The reminder feeds (service role): the plan's dose schedule and the supplement due list. */
  const reminders = async () => {
    const service = serviceClient();
    const doses = (await ok(service.rpc("cycle_plan_occurrences", { p_plan_id: planId }), "dose schedule")) as unknown as unknown[];
    const now = Date.now();
    const due = await listDueSupplements(service, new Date(now - 26 * 3_600_000).toISOString(), new Date(now + 3_600_000).toISOString());
    return { doses: doses.length > 0, supplements: due.some((o) => o.routineId === routineId) };
  };

  beforeAll(async () => {
    // Not within a minute of Toronto's midnight, so the check-in day stays put.
    while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
    for (const [key, email] of Object.entries(people) as [keyof typeof people, string][]) {
      const id = await ensureAccount({
        email,
        name: `Terms ${key}`,
        role: key === "owner" ? "researcher" : "admin",
        ...(key === "outdatedAdmin" ? { termsVersion: OLD_VERSION } : {}),
      });
      who[key] = { id, db: await signedInClient(email) };
    }
    // The owner's records, written while on the current terms: a cycle with a
    // recorded dose, a check-in, a supplement routine and a device for
    // reminders; and a share with the team.
    const owner = who.owner.db;
    const peptideId = await createPeptide(who.admin.db, `Terms reads ${tag()}`);
    cycleId = await createCycle(owner, { timeZone: NOON, plans: [plan(peptideId, [interval(d(-4), d(20), "0.5", 2, "08:00")])] });
    planId = (await ok(owner.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan"))[0].id;
    await ok(owner.rpc("confirm_dose", (await confirmArgsSeen(owner, await occurrenceOn(owner, cycleId, d(0)))) as never), "confirm");
    const checkIn = await saveCheckIn(owner, {
      day: checkInDay(new Date()),
      version: null,
      feeling: 4,
      effects: [],
      effectsOther: "",
      note: "",
      measurement: null,
    });
    expect(checkIn).toMatchObject({ kind: "saved" });
    await ok(owner.rpc("set_supplement_tracking", { p_enabled: true }), "tracking on");
    const routine = (await ok(
      owner.rpc("save_supplement_routine", {
        p_id: null as unknown as string,
        p_version: null as unknown as number,
        p_name: "Vitamin D3",
        p_amount: "2000",
        p_unit: "IU",
        // Midnight: today's occurrence is inside the feed's window below.
        p_time: "00:00",
      }),
      "routine",
    )) as unknown as { id: string };
    routineId = routine.id;
    endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
    const device = await owner.rpc("save_push_subscription", {
      p_endpoint: endpoint,
      p_p256dh: randomBytes(65).toString("base64url"),
      p_auth: randomBytes(16).toString("base64url"),
      p_device_label: "iPhone",
      p_device_id: randomUUID(),
      p_mode: "turn_on",
    });
    expect(device.data).toBe("saved");
    await ok(owner.rpc("share_with_team"), "share");
    expect(await ownReads()).toEqual(ALL);
    expect(await reminders()).toEqual({ doses: true, supplements: true });

    // The terms change under them: their agreement is now to an earlier version.
    const { error } = await serviceClient().from("profiles").update({ acknowledgement_version: OLD_VERSION }).eq("id", who.owner.id);
    if (error) throw error;
  });

  it("reads none of its own records directly, even through the API", async () => {
    expect(await ownReads()).toEqual(NONE);
    expect((await who.owner.db.rpc("can_read_researcher", { p_owner: who.owner.id })).data).toBe(false);
  });

  it("stays readable by the team while it shares, by an admin on an earlier version too", async () => {
    for (const admin of [who.admin, who.outdatedAdmin]) {
      expect((await admin.db.from("cycles").select("id").eq("id", cycleId)).data).toHaveLength(1);
      expect((await admin.db.from("dose_records").select("id").eq("cycle_id", cycleId)).data).toHaveLength(1);
      expect((await admin.db.from("progress_check_ins").select("id").eq("owner_id", who.owner.id)).data).toHaveLength(1);
    }
    // The outdated admin's own records stay closed to them, as for anyone on an earlier version.
    expect((await who.outdatedAdmin.db.rpc("can_read_researcher", { p_owner: who.outdatedAdmin.id })).data).toBe(false);
  });

  it("gets no reminders, and its device stays in place", async () => {
    expect(await reminders()).toEqual({ doses: false, supplements: false });
    const { data: device } = await serviceClient().from("push_subscriptions").select("profile_id, disabled_reason").eq("endpoint", endpoint).single();
    expect(device).toEqual({ profile_id: who.owner.id, disabled_reason: null });
  });

  it("reads its records and gets its reminders again once it agrees", async () => {
    expect((await who.owner.db.rpc("record_acknowledgement", { p_version: ACKNOWLEDGEMENT_VERSION })).data).toBe(true);
    expect(await ownReads()).toEqual(ALL);
    expect(await reminders()).toEqual({ doses: true, supplements: true });
  });
});
