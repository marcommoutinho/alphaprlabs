// S17 R11 Me and A8 support history against the real local Supabase, through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// the researcher grants and revokes (with the grant history and the admins
// they may choose); the A8 list gives an admin every account's grant state
// towards them; while granted, the admin reads every area of the history
// with the owner-scoped reads (RLS, never the secret key) and every write
// they attempt is refused; a revoke denies the very next read; peptide names
// no longer offered reach the granted admin and not other researchers; and
// no business or push record is ever part of the history.
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle } from "@/lib/doses/service";
import { recordPurchase, recordSale } from "@/lib/inventory/service";
import { checkInDay } from "@/lib/progress/rules";
import { saveCheckIn } from "@/lib/progress/service";
import { canReadResearcher } from "@/lib/support/access";
import {
  adminPeptideNames,
  getSupportAccount,
  grantSupport,
  listGrantHistory,
  listSupportAccounts,
  listSupportAdmins,
  readResearcherRecords,
  revokeSupport,
} from "@/lib/support/service";
import { historyView } from "@/lib/support/view";
import { type Client, createCycle, createPeptide, day, interval, plan, setAvailable, tag } from "../support/cycles";
import { confirmArgs, confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s17-alex"), name: `Alex History ${tag()}`, role: "researcher" },
  blair: { email: uniqueEmail("s17-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s17-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s17-grace"), name: `Grace Granted ${tag()}`, role: "admin" },
  noah: { email: uniqueEmail("s17-noah"), name: `Noah Not Granted ${tag()}`, role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const peptide = { a: "", aName: "", w: "", wName: "" };
const alex = { cycleId: "", planA: "", mixtureId: "", vialId: "", routineId: "", endpoint: "", p256dh: "" };
let today = "";

const RESEARCHER_TABLES = [
  "cycles",
  "cycle_plans",
  "cycle_revisions",
  "cycle_revision_plans",
  "cycle_revision_phases",
  "dose_records",
  "mixtures",
  "mixture_versions",
  "cycle_plan_mixtures",
  "personal_vials",
  "personal_supply_settings",
  "personal_vial_deductions",
  "progress_check_ins",
  "supplement_settings",
  "supplement_routines",
  "supplement_taken",
] as const;

/** Alex's whole history as the app reads it for A8 (the owner-scoped reads), as `who`. */
const records = (who: Name) => readResearcherRecords(db[who], id.alex);

/** Every area empty: what a reader without an active grant gets. */
function expectNothing(r: Awaited<ReturnType<typeof records>>, who: string) {
  expect(r.cycles, who).toEqual([]);
  expect(r.doses, who).toEqual([]);
  expect(r.checkIns, who).toEqual([]);
  expect(r.vials, who).toEqual([]);
  expect(r.mixtures, who).toEqual([]);
  expect(r.deductions, who).toEqual([]);
  expect(r.routines, who).toEqual([]);
  expect(r.taken, who).toEqual([]);
  expect(r.supplyTracking, who).toBe(false);
  expect(r.supplementTracking, who).toBe(false);
}

beforeAll(async () => {
  // Not within a minute of Toronto's midnight, so the check-in day stays put for the run.
  while (checkInDay(new Date()) !== checkInDay(new Date(Date.now() + 60_000))) await new Promise((r) => setTimeout(r, 5_000));
  today = checkInDay(new Date());
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  peptide.aName = `History A ${tag()}`;
  peptide.a = await createPeptide(db.grace, peptide.aName);
  peptide.wName = `History W ${tag()}`;
  peptide.w = await createPeptide(db.grace, peptide.wName);

  // Alex: a cycle with A and W (0.4 mg every 2 days at 08:00 from 4 days ago), today's A dose taken.
  alex.cycleId = await createCycle(db.alex, {
    name: "Alex recomposition",
    goal: "Leaner by October",
    timeZone: NOON,
    plans: [plan(peptide.a, [interval(d(-4), d(20), "0.4", 2, "08:00")]), plan(peptide.w, [interval(d(-4), d(20), "0.3", 2, "08:00")])],
  });
  const plans = await ok(db.alex.from("cycle_plans").select("id, peptide_id").eq("cycle_id", alex.cycleId), "plans");
  alex.planA = plans.find((p) => p.peptide_id === peptide.a)!.id;
  const planW = plans.find((p) => p.peptide_id === peptide.w)!.id;
  // Supplies: tracking on, a mixture for A and an open vial.
  await ok(db.alex.rpc("set_supply_tracking", { p_enabled: true }), "supply tracking");
  alex.mixtureId = (await ok(
    db.alex.rpc("save_mixture", { p_peptide_id: peptide.a, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [alex.planA] }),
    "mixture",
  ))!;
  alex.vialId = (await ok(
    db.alex.rpc("save_personal_vial", { p_label: "A-01", p_peptide_id: peptide.a, p_strength_mg: "10", p_mixture_id: alex.mixtureId }),
    "vial",
  ))!;
  for (const planId of [alex.planA, planW]) {
    const due = await occurrenceOn(db.alex, alex.cycleId, d(0), planId);
    await ok(db.alex.rpc("confirm_dose", (await confirmArgsSeen(db.alex, due)) as never), "confirm");
  }
  // A check-in with a measurement.
  const saved = await saveCheckIn(db.alex, {
    day: today,
    version: null,
    feeling: 4,
    effects: ["Mild headache"],
    note: "Slept better.",
    measurement: { name: "Weight", value: "82.4", unit: "kg" },
  });
  if (saved.kind !== "saved") throw new Error(`check-in: ${saved.kind}`);
  // Supplements: tracking on, a routine taken today.
  await ok(db.alex.rpc("set_supplement_tracking", { p_enabled: true }), "supplement tracking");
  const routine = (await ok(
    db.alex.rpc("save_supplement_routine", {
      p_id: null as unknown as string,
      p_version: null as unknown as number,
      p_name: "Vitamin D3",
      p_amount: "2000",
      p_unit: "IU",
      p_time: "00:00",
    }),
    "routine",
  )) as unknown as { id: string };
  alex.routineId = routine.id;
  const { occurrenceOn: supplementOn } = await import("@/lib/supplements/schedule");
  const scheduledAt = supplementOn({ id: routine.id, time: "00:00", timeZone: "America/Toronto", definitionFrom: today, endDate: null }, today)!.scheduledAt;
  await ok(
    db.alex.rpc("take_supplement", {
      p_request_key: randomUUID(),
      p_occurrence_key: `${routine.id}:${today}`,
      p_seen_scheduled_at: scheduledAt,
      p_seen_name: "Vitamin D3",
      p_seen_amount: "2000",
      p_seen_unit: "IU",
    }),
    "take",
  );
  // A phone subscribed for reminders, and a business sale to Alex's account: neither is history.
  alex.endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
  alex.p256dh = randomBytes(65).toString("base64url");
  await ok(
    db.alex.rpc("save_push_subscription", {
      p_endpoint: alex.endpoint,
      p_p256dh: alex.p256dh,
      p_auth: randomBytes(16).toString("base64url"),
      p_device_label: "Android · Chrome",
      p_device_id: randomUUID(),
      p_mode: "turn_on",
    }),
    "push subscription",
  );
  const purchase = await recordPurchase(db.grace, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId: peptide.a,
    strengthMg: "10",
    receivedOn: day(-3),
    quantity: 5,
    unitCost: "23.17",
  });
  if (purchase.kind !== "recorded") throw new Error(`purchase: ${purchase.kind}`);
  const sale = await recordSale(db.grace, {
    idempotencyKey: randomUUID(),
    stockItemId: purchase.stockItemId,
    soldOn: day(-1),
    quantity: 2,
    unitPrice: "41.93",
    buyer: { type: "account", profileId: id.alex },
  });
  if (sale.kind !== "recorded") throw new Error(`sale: ${sale.kind}`);
  // W stops being offered after Alex started using it.
  await setAvailable(db.grace, peptide.w, peptide.wName, false);
}, 120_000);

describe("R11: granting and revoking", () => {
  it("offers every other admin by name; grants and revokes only the caller's own access, keeping the history", async () => {
    const offered = await listSupportAdmins(db.alex);
    expect(offered).toEqual(expect.arrayContaining([{ id: id.grace, name: people.grace.name }, { id: id.noah, name: people.noah.name }]));
    expect(offered.map((a) => a.id)).not.toContain(id.blair);
    expect(Object.keys(offered[0]).sort()).toEqual(["id", "name"]);
    // An admin granting from their own profile is offered the other admins only.
    expect((await listSupportAdmins(db.grace)).map((a) => a.id)).not.toContain(id.grace);
    // Paged by keyset, a page of one at a time: each admin once, none lost
    // (other test files may add admins meanwhile, never remove one).
    const paged = await listSupportAdmins(db.alex, 1);
    expect(new Set(paged.map((a) => a.id)).size).toBe(paged.length);
    expect(paged).toEqual(expect.arrayContaining(offered));
    // Unacknowledged and anonymous callers are refused.
    expect(await sqlState(db.una.rpc("support_admins"), "una")).toBe("42501");
    expect(await sqlState(anonClient().rpc("support_admins"), "anon")).not.toBe("ok");
    expect(await sqlState(anonClient().rpc("support_grant_history"), "anon history")).not.toBe("ok");

    // Only an admin other than the caller can be granted.
    expect(await grantSupport(db.alex, id.blair)).toEqual({ kind: "refused" });
    expect(await grantSupport(db.grace, id.grace)).toEqual({ kind: "refused" });
    expect(await grantSupport(db.alex, randomUUID())).toEqual({ kind: "refused" });
    expect(await grantSupport(db.una, id.grace)).toEqual({ kind: "refused" });

    expect(await grantSupport(db.alex, id.grace)).toEqual({ kind: "granted" });
    // Granting again changes nothing.
    expect(await grantSupport(db.alex, id.grace)).toEqual({ kind: "granted" });
    let history = await listGrantHistory(db.alex);
    expect(history).toEqual([
      { id: expect.any(String), adminId: id.grace, adminName: people.grace.name, stillAdmin: true, grantedAt: expect.any(String), revokedAt: null },
    ]);
    // Nobody else sees Alex's grants (Grace's own history is her grants as a researcher).
    expect(await listGrantHistory(db.blair)).toEqual([]);
    expect(await listGrantHistory(db.grace)).toEqual([]);

    expect(await revokeSupport(db.alex, id.grace)).toEqual({ kind: "revoked" });
    expect(await revokeSupport(db.alex, id.grace)).toEqual({ kind: "not_active" });
    expect(await grantSupport(db.alex, id.grace)).toEqual({ kind: "granted" });
    history = await listGrantHistory(db.alex);
    expect(history).toHaveLength(2);
    expect(history[0].revokedAt).toBeNull();
    expect(history[1].revokedAt).not.toBeNull();
    expect(await listGrantHistory(db.alex, 1)).toEqual(history);
    // An unacknowledged account can still see (and end) what it shared.
    expect(await listGrantHistory(db.una)).toEqual([]);
    expect(await revokeSupport(db.alex, id.grace)).toEqual({ kind: "revoked" });
  });
});

describe("A8: the support list", () => {
  it("gives each admin every other account's grant state towards them, and nothing to researchers", async () => {
    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant");
    try {
      const forGrace = await listSupportAccounts(db.grace);
      const alexRow = forGrace.find((a) => a.id === id.alex)!;
      expect(alexRow).toMatchObject({ name: people.alex.name, email: people.alex.email, grantedAt: expect.any(String) });
      expect(forGrace.find((a) => a.id === id.blair)).toMatchObject({ grantedAt: null, revokedAt: null });
      expect(forGrace.map((a) => a.id)).not.toContain(id.grace);
      expect(forGrace.map((a) => a.id)).toContain(id.noah);
      // Noah holds no grant from Alex.
      expect((await listSupportAccounts(db.noah)).find((a) => a.id === id.alex)).toMatchObject({ grantedAt: null, revokedAt: null });
      expect(await getSupportAccount(db.grace, id.alex)).toEqual(alexRow);
      expect(await getSupportAccount(db.grace, randomUUID())).toBeNull();
      expect(await getSupportAccount(db.grace, "not-an-id")).toBeNull();
      // Researchers and anonymous callers get nothing.
      for (const who of ["alex", "blair", "una"] as const) {
        expect(await sqlState(db[who].rpc("admin_support_researchers"), who)).toBe("42501");
      }
      expect(await sqlState(anonClient().rpc("admin_support_researchers"), "anon")).not.toBe("ok");
    } finally {
      await ok(db.alex.rpc("revoke_support_access", { p_admin_id: id.grace }), "revoke");
    }
    const revoked = await getSupportAccount(db.grace, id.alex);
    expect(revoked).toMatchObject({ grantedAt: null, revokedAt: expect.any(String) });
  });
});

describe("A8: the researcher history", () => {
  it("reads every area only while granted, refuses every write, and denies the next read after a revoke", async () => {
    const own = await records("alex");
    expect(own.cycles).toHaveLength(1);
    expect(own.doses).toHaveLength(2);
    expect(own.checkIns).toHaveLength(1);
    expect(own.vials).toHaveLength(1);
    expect(own.mixtures).toHaveLength(1);
    expect(own.deductions).toHaveLength(1);
    expect(own.routines).toHaveLength(1);
    expect(own.taken).toHaveLength(1);

    // Before any grant: nothing, for the admins and another researcher alike.
    for (const who of ["grace", "noah", "blair", "una"] as const) expectNothing(await records(who), who);
    expect(await canReadResearcher(db.grace, id.alex)).toBe(false);

    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant");
    expect(await canReadResearcher(db.grace, id.alex)).toBe(true);
    const granted = await records("grace");
    // The same history the owner reads.
    expect(granted).toEqual(own);
    for (const who of ["noah", "blair"] as const) expectNothing(await records(who), who);

    // The four cards, with W's name although it is no longer offered.
    const peptides = await adminPeptideNames(db.grace);
    const view = historyView({ ...granted, peptides, confirmations: confirmationsByCycle(granted.doses), now: new Date(), full: false });
    expect(view.cycles).toEqual([expect.objectContaining({ name: "Alex recomposition", goal: "Leaner by October", peptides: expect.stringContaining(peptide.wName) })]);
    expect(view.doses.map((dose) => dose.peptide).sort()).toEqual([peptide.aName, peptide.wName].sort());
    expect(view.checkIns).toEqual([expect.objectContaining({ feeling: 4, effects: "Mild headache", note: "Slept better." })]);
    expect(view.measures).toMatch(/^Measurements: Weight 82\.4 kg \(/);
    expect(view.supplies).toMatch(/^Supplies tracked: A-01 · History A .* 10 mg · est\. 9\.6 mg left$/);
    expect(view.supplements).toBe("Supplement routines: Vitamin D3 2000 IU daily 00:00");
    expect(view.taken).toHaveLength(1);

    // Every write the granted admin attempts is refused, and nothing of Alex's changes.
    const before = await records("alex");
    const due = await occurrenceOn(db.alex, alex.cycleId, d(2), alex.planA);
    const cycleVersion = before.cycles[0].version;
    const writes: [string, PromiseLike<{ data: unknown; error: { code?: string } | null }>][] = [
      [
        "save_cycle",
        db.grace.rpc("save_cycle", {
          p_name: "Taken over",
          p_goal: "x",
          p_baseline: "",
          p_time_zone: NOON,
          p_plans: [plan(peptide.a, [interval(d(3), d(9))])] as never,
          p_cycle_id: alex.cycleId,
          p_version: cycleVersion,
        }),
      ],
      ["confirm_dose", db.grace.rpc("confirm_dose", confirmArgs(due) as never)],
      [
        "save_mixture",
        db.grace.rpc("save_mixture", {
          p_peptide_id: peptide.a,
          p_vial_mg: "20",
          p_liquid_ml: "2",
          p_syringe_units: 100,
          p_line_spacing: "2",
          p_plan_ids: [],
          p_mixture_id: alex.mixtureId,
          p_version: before.mixtures[0].version,
        }),
      ],
      ["delete_mixture", db.grace.rpc("delete_mixture", { p_mixture_id: alex.mixtureId, p_version: before.mixtures[0].version })],
      ["save_personal_vial", db.grace.rpc("save_personal_vial", { p_label: "Hijack", p_peptide_id: peptide.a, p_strength_mg: "10", p_vial_id: alex.vialId })],
      ["finish_personal_vial", db.grace.rpc("finish_personal_vial", { p_vial_id: alex.vialId })],
      ["reopen_personal_vial", db.grace.rpc("reopen_personal_vial", { p_vial_id: alex.vialId })],
      [
        "save_supplement_routine",
        db.grace.rpc("save_supplement_routine", { p_id: alex.routineId, p_version: 1, p_name: "Changed", p_amount: "1", p_unit: "mg", p_time: "09:00" }),
      ],
      ["end_supplement_routine", db.grace.rpc("end_supplement_routine", { p_id: alex.routineId, p_version: 1 })],
      [
        "take_supplement",
        db.grace.rpc("take_supplement", {
          p_request_key: randomUUID(),
          p_occurrence_key: `${alex.routineId}:${today}`,
          p_seen_scheduled_at: before.taken[0].scheduledAt,
          p_seen_name: "Vitamin D3",
          p_seen_amount: "2000",
          p_seen_unit: "IU",
        }),
      ],
      ["revoke someone else's grant", db.grace.rpc("revoke_support_access", { p_admin_id: id.grace })],
    ];
    for (const [what, call] of writes) {
      const { data, error } = await call;
      // Refused either way: nothing returned (not theirs) or an error.
      expect(error ? "refused" : data === null || data === false ? "refused" : `wrote ${JSON.stringify(data)}`, what).toBe("refused");
    }
    // The owner-bound writes act on the admin's own records only.
    const graceCheckIn = await saveCheckIn(db.grace, { day: today, version: null, feeling: 1, effects: [], note: "Grace's own", measurement: null });
    expect(graceCheckIn.kind).toBe("saved");
    await ok(db.grace.rpc("set_supply_tracking", { p_enabled: false }), "grace's own supply tracking");
    await ok(db.grace.rpc("set_supplement_tracking", { p_enabled: false }), "grace's own supplement tracking");
    // Direct table writes are refused for every researcher table.
    for (const table of RESEARCHER_TABLES) {
      expect(await sqlState(db.grace.from(table).delete().eq("owner_id", id.alex), `delete ${table}`), table).toBe("42501");
      expect(await sqlState(db.grace.from(table).update({ owner_id: id.grace } as never).eq("owner_id", id.alex), `update ${table}`), table).toBe("42501");
    }
    expect(await sqlState(db.grace.from("support_grants").update({ revoked_at: null } as never).eq("researcher_id", id.alex), "grant row")).toBe("42501");
    expect(await records("alex")).toEqual(before);
    expect(await canReadResearcher(db.grace, id.alex)).toBe(true);

    // Revoking denies the very next read, of every area.
    await ok(db.alex.rpc("revoke_support_access", { p_admin_id: id.grace }), "revoke");
    expect(await canReadResearcher(db.grace, id.alex)).toBe(false);
    expectNothing(await records("grace"), "revoked");
    for (const table of RESEARCHER_TABLES) {
      expect(await ok(db.grace.from(table).select("owner_id").eq("owner_id", id.alex), table), table).toEqual([]);
    }
  });

  it("shows names no longer offered to admins only; researchers keep only their own", async () => {
    const names = await adminPeptideNames(db.grace);
    expect(names.get(peptide.w)).toEqual({ name: peptide.wName, available: false });
    // Researchers (and admins on the research side) browse offered peptides only; Alex keeps W through his own cycle.
    expect((await listCyclePeptides(db.blair)).map((p) => p.id)).not.toContain(peptide.w);
    expect((await listCyclePeptides(db.grace)).map((p) => p.id)).not.toContain(peptide.w);
    expect((await listCyclePeptides(db.alex)).map((p) => p.id)).toContain(peptide.w);
    // The admin path is refused to researchers.
    expect(await sqlState(db.blair.rpc("admin_library_peptides"), "blair")).toBe("42501");
    expect(await sqlState(db.alex.rpc("admin_library_peptides"), "alex")).toBe("42501");
  });

  it("never carries business stock, sales or push subscriptions", async () => {
    await ok(db.alex.rpc("grant_support_access", { p_admin_id: id.grace }), "grant");
    try {
      const r = await records("grace");
      const view = historyView({ ...r, peptides: await adminPeptideNames(db.grace), confirmations: confirmationsByCycle(r.doses), now: new Date(), full: true });
      const account = await getSupportAccount(db.grace, id.alex);
      const payload = JSON.stringify({ r, view, account });
      // The history is complete: the sale and the subscription exist, yet none of them is in it.
      expect(payload).toContain("Vitamin D3");
      const sold = await ok(serviceClient().from("business_sales").select("id").eq("buyer_profile_id", id.alex), "sales");
      expect(sold).toHaveLength(1);
      for (const secret of [alex.endpoint, alex.p256dh, "23.17", "41.93", "83.86", sold[0].id]) expect(payload, secret).not.toContain(secret);
      expect(payload).not.toMatch(/"(revenue|cost|unit_price|unit_cost|endpoint|p256dh|auth|stock_item_id|buyer_[a-z_]+)"\s*:/i);
    } finally {
      await ok(db.alex.rpc("revoke_support_access", { p_admin_id: id.grace }), "revoke");
    }
  });
});
