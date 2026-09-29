// S17 R11 Me and A8 support history against the real local Supabase, through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// the researcher shares with the Alpha PR Labs team and stops (with the
// share history); the A8 list gives admins the researchers sharing now;
// while shared, every admin reads every area of the history with the
// owner-scoped reads (RLS, never the secret key), every mixture record
// included, and every write they attempt is refused; stopping denies the
// very next read; peptide names no longer offered reach admins and not
// other researchers; no business or push record is ever part of the
// history; and nothing a researcher can read names an admin.
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle } from "@/lib/doses/service";
import { recordPurchase } from "@/lib/inventory/service";
import { recordSale } from "../support/previewed-sale";
import { viewInvitation } from "@/lib/invitations/service";
import { getMixture } from "@/lib/mixtures/service";
import { checkInDay } from "@/lib/progress/rules";
import { saveCheckIn } from "@/lib/progress/service";
import { canReadResearcher } from "@/lib/support/access";
import {
  adminPeptideNames,
  getSupportAccount,
  listShareHistory,
  listSupportAccounts,
  readResearcherRecords,
  shareWithTeam,
  stopSharing,
} from "@/lib/support/service";
import { historyView } from "@/lib/support/view";
import { type Client, createCycle, createPeptide, day, interval, plan, setAvailable, tag } from "../support/cycles";
import { confirmArgs, confirmArgsSeen, d, NOON, occurrenceOn } from "../support/doses";
import { anonClient, ensureAccount, ok, seedInvitation, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const people = {
  alex: { email: uniqueEmail("s17-alex"), name: `Alex History ${tag()}`, role: "researcher" },
  blair: { email: uniqueEmail("s17-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s17-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s17-grace"), name: `Grace Admin ${tag()}`, role: "admin" },
  noah: { email: uniqueEmail("s17-noah"), name: `Noah Admin ${tag()}`, role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const peptide = { a: "", aName: "", w: "", wName: "" };
const alex = { cycleId: "", planA: "", mixtureId: "", deletedMixtureId: "", vialId: "", routineId: "", endpoint: "", p256dh: "", inviteToken: "" };
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

/** Every area empty: what a reader gets while the researcher isn't sharing. */
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
  // A mixture for W saved, edited, then deleted: A8 still shows it with both setups.
  const wSetup = { p_peptide_id: peptide.w, p_vial_mg: "5", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] };
  alex.deletedMixtureId = (await ok(db.alex.rpc("save_mixture", wSetup), "w mixture"))!;
  await ok(db.alex.rpc("save_mixture", { ...wSetup, p_liquid_ml: "2.5", p_mixture_id: alex.deletedMixtureId, p_version: 1 }), "w edit");
  const edited = await getMixture(db.alex, alex.deletedMixtureId);
  expect(await ok(db.alex.rpc("delete_mixture", { p_mixture_id: alex.deletedMixtureId, p_version: edited!.version }), "w delete")).toBeTruthy();
  for (const planId of [alex.planA, planW]) {
    const due = await occurrenceOn(db.alex, alex.cycleId, d(0), planId);
    await ok(db.alex.rpc("confirm_dose", (await confirmArgsSeen(db.alex, due)) as never), "confirm");
  }
  // A check-in with a measurement.
  const saved = await saveCheckIn(db.alex, {
    day: today,
    version: null,
    feeling: 4,
    effects: ["Headache", "Other"],
    effectsOther: "dizzy in the evening",
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
    sellerId: id.grace,
    buyer: { type: "account", profileId: id.alex },
  });
  if (sale.kind !== "recorded") throw new Error(`sale: ${sale.kind}`);
  // An invitation Grace sent (to someone not yet signed up).
  alex.inviteToken = await seedInvitation({ email: uniqueEmail("s17-invitee"), name: "Invitee", invitedBy: id.grace });
  // W stops being offered after Alex started using it.
  await setAvailable(db.grace, peptide.w, peptide.wName, false);
}, 120_000);

describe("R11: sharing with the team and stopping", () => {
  it("shares and stops only the caller's own history, keeping when it started and stopped", async () => {
    // An unacknowledged account can't share; anonymous callers can do nothing.
    expect(await shareWithTeam(db.una)).toEqual({ kind: "error" });
    expect(await stopSharing(db.una)).toEqual({ kind: "not_sharing" });
    expect(await sqlState(anonClient().rpc("share_with_team"), "anon")).not.toBe("ok");

    expect(await listShareHistory(db.alex, id.alex)).toEqual([]);
    expect(await shareWithTeam(db.alex)).toEqual({ kind: "shared" });
    // Sharing again changes nothing.
    expect(await shareWithTeam(db.alex)).toEqual({ kind: "shared" });
    let history = await listShareHistory(db.alex, id.alex);
    expect(history).toEqual([{ id: expect.any(String), startedAt: expect.any(String), stoppedAt: null }]);
    // Nobody else's history holds Alex's share, even an admin's own.
    expect(await listShareHistory(db.blair, id.blair)).toEqual([]);
    expect(await listShareHistory(db.grace, id.grace)).toEqual([]);
    // Stopping someone else's share isn't possible: stopping acts on the caller's own.
    expect(await stopSharing(db.blair)).toEqual({ kind: "not_sharing" });
    expect(await canReadResearcher(db.grace, id.alex)).toBe(true);

    expect(await stopSharing(db.alex)).toEqual({ kind: "stopped" });
    expect(await stopSharing(db.alex)).toEqual({ kind: "not_sharing" });
    expect(await shareWithTeam(db.alex)).toEqual({ kind: "shared" });
    history = await listShareHistory(db.alex, id.alex);
    expect(history).toHaveLength(2);
    expect(history[0].stoppedAt).toBeNull();
    expect(history[1].stoppedAt).not.toBeNull();
    expect(Date.parse(history[1].stoppedAt!)).toBeGreaterThanOrEqual(Date.parse(history[1].startedAt));
    // Paged by keyset, a page of one at a time: the same history.
    expect(await listShareHistory(db.alex, id.alex, { pageSize: 1 })).toEqual(history);
    expect(await stopSharing(db.alex)).toEqual({ kind: "stopped" });
  });
});

describe("A8: the support list", () => {
  it("lists only the researchers sharing now, for every admin, and nothing to researchers", async () => {
    // Blair never shared; Alex isn't sharing now: neither is listed, but each opens (to the denied state).
    const before = (await listSupportAccounts(db.grace)).map((a) => a.id);
    expect(before).not.toContain(id.alex);
    expect(before).not.toContain(id.blair);
    expect(await getSupportAccount(db.grace, id.blair)).toMatchObject({ id: id.blair, sharedSince: null, stoppedAt: null });
    expect(await getSupportAccount(db.grace, id.alex)).toMatchObject({ sharedSince: null, stoppedAt: expect.any(String) });

    await ok(db.alex.rpc("share_with_team"), "share");
    try {
      const forGrace = await listSupportAccounts(db.grace);
      const alexRow = forGrace.find((a) => a.id === id.alex)!;
      expect(alexRow).toMatchObject({ name: people.alex.name, email: people.alex.email, sharedSince: expect.any(String) });
      expect(forGrace.every((a) => a.sharedSince !== null)).toBe(true);
      expect(forGrace.map((a) => a.id)).not.toContain(id.blair);
      // Every admin sees the share, the same way.
      expect((await listSupportAccounts(db.noah)).find((a) => a.id === id.alex)).toEqual(alexRow);
      // Paged by keyset, a page of one at a time: each sharing account once, none lost.
      const paged = await listSupportAccounts(db.grace, { pageSize: 1 });
      expect(new Set(paged.map((a) => a.id)).size).toBe(paged.length);
      expect(paged.map((a) => a.id)).toContain(id.alex);
      expect(await getSupportAccount(db.grace, id.alex)).toEqual(alexRow);
      expect(await getSupportAccount(db.grace, randomUUID())).toBeNull();
      expect(await getSupportAccount(db.grace, "not-an-id")).toBeNull();
      // An admin sharing their own history isn't in their own list; the other admins see it.
      await ok(db.grace.rpc("share_with_team"), "grace shares");
      expect((await listSupportAccounts(db.grace)).map((a) => a.id)).not.toContain(id.grace);
      expect((await listSupportAccounts(db.noah)).map((a) => a.id)).toContain(id.grace);
      await ok(db.grace.rpc("stop_sharing_with_team"), "grace stops");
      // Researchers and anonymous callers get nothing.
      for (const who of ["alex", "blair", "una"] as const) {
        expect(await sqlState(db[who].rpc("admin_support_researchers"), who)).toBe("42501");
      }
      expect(await sqlState(anonClient().rpc("admin_support_researchers"), "anon")).not.toBe("ok");
    } finally {
      await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    }
    expect((await listSupportAccounts(db.grace)).map((a) => a.id)).not.toContain(id.alex);
    expect(await getSupportAccount(db.grace, id.alex)).toMatchObject({ sharedSince: null, stoppedAt: expect.any(String) });
  });
});

describe("A8: the researcher history", () => {
  it("reads every area only while shared, refuses every write, and denies the next read after stopping", async () => {
    const own = await records("alex");
    expect(own.cycles).toHaveLength(1);
    expect(own.doses).toHaveLength(2);
    expect(own.checkIns).toHaveLength(1);
    expect(own.vials).toHaveLength(1);
    // Every mixture record: the current one and the deleted one, with every setup.
    expect(own.mixtures.map((m) => [m.id, m.deletedAt === null, m.versions.map((v) => v.number)])).toEqual([
      [alex.mixtureId, true, [1]],
      [alex.deletedMixtureId, false, [1, 2]],
    ]);
    expect(own.deductions).toHaveLength(1);
    expect(own.routines).toHaveLength(1);
    expect(own.taken).toHaveLength(1);

    // Not sharing: nothing, for the admins and another researcher alike.
    for (const who of ["grace", "noah", "blair", "una"] as const) expectNothing(await records(who), who);
    expect(await canReadResearcher(db.grace, id.alex)).toBe(false);

    await ok(db.alex.rpc("share_with_team"), "share");
    expect(await canReadResearcher(db.grace, id.alex)).toBe(true);
    const shared = await records("grace");
    // The same history the owner reads, for every admin; never for another researcher.
    expect(shared).toEqual(own);
    expect(await records("noah")).toEqual(own);
    for (const who of ["blair", "una"] as const) expectNothing(await records(who), who);

    // The four cards, with W's name although it is no longer offered.
    const peptides = await adminPeptideNames(db.grace);
    const view = historyView({ ...shared, peptides, confirmations: confirmationsByCycle(shared.doses), now: new Date(), full: false });
    expect(view.cycles).toEqual([expect.objectContaining({ name: "Alex recomposition", goal: "Leaner by October", peptides: expect.stringContaining(peptide.wName) })]);
    expect(view.doses.map((dose) => dose.peptide).sort()).toEqual([peptide.aName, peptide.wName].sort());
    expect(view.checkIns).toEqual([expect.objectContaining({ feeling: 4, effects: "Headache, Other: dizzy in the evening", note: "Slept better." })]);
    expect(view.measures).toMatch(/^Measurements: Weight 82\.4 kg \(/);
    expect(view.supplies).toMatch(/^Supplies tracked: A-01 · History A .* 10 mg · est\. 9\.6 mg left$/);
    expect(view.supplements).toBe("Supplement routines: Vitamin D3 2000 IU daily 00:00");
    expect(view.taken).toHaveLength(1);
    // The edited-then-deleted mixture, with each setup and the date it took effect.
    const deleted = view.mixtures.find((m) => m.id === alex.deletedMixtureId)!;
    expect(deleted).toMatchObject({ deleted: true, title: `${peptide.wName} · 5 mg / 2.5 mL · 1 mL`, state: expect.stringMatching(/^saved .+ · deleted .+$/) });
    expect(deleted.versions.map((v) => v.line)).toEqual([
      expect.stringMatching(/^Setup 1 · 5 mg \/ 2 mL · 1 mL syringe · from \w{3} \w{3} \d+ · \d\d:\d\d$/),
      expect.stringMatching(/^Setup 2 · 5 mg \/ 2\.5 mL · 1 mL syringe · from /),
    ]);
    expect(view.mixtures.find((m) => m.id === alex.mixtureId)).toMatchObject({ deleted: false, title: `${peptide.aName} · 10 mg / 2 mL · 1 mL` });

    // Every write an admin attempts is refused, and nothing of Alex's changes.
    const before = await records("alex");
    const mixtureVersion = (await getMixture(db.alex, alex.mixtureId))!.version;
    const due = await occurrenceOn(db.alex, alex.cycleId, d(2), alex.planA);
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
          p_version: before.cycles[0].version,
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
          p_version: mixtureVersion,
        }),
      ],
      ["delete_mixture", db.grace.rpc("delete_mixture", { p_mixture_id: alex.mixtureId, p_version: mixtureVersion })],
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
      // Stopping acts on the caller's own share only.
      ["stop someone else's share", db.grace.rpc("stop_sharing_with_team")],
    ];
    for (const [what, call] of writes) {
      const { data, error } = await call;
      // Refused either way: nothing returned (not theirs) or an error.
      expect(error ? "refused" : data === null || data === false ? "refused" : `wrote ${JSON.stringify(data)}`, what).toBe("refused");
    }
    // The owner-bound writes act on the admin's own records only.
    const graceCheckIn = await saveCheckIn(db.grace, { day: today, version: null, feeling: 1, effects: [], effectsOther: "", note: "Grace's own", measurement: null });
    expect(graceCheckIn.kind).toBe("saved");
    await ok(db.grace.rpc("set_supply_tracking", { p_enabled: false }), "grace's own supply tracking");
    await ok(db.grace.rpc("set_supplement_tracking", { p_enabled: false }), "grace's own supplement tracking");
    // Direct table writes are refused for every researcher table, and for the shares.
    for (const table of RESEARCHER_TABLES) {
      expect(await sqlState(db.grace.from(table).delete().eq("owner_id", id.alex), `delete ${table}`), table).toBe("42501");
      expect(await sqlState(db.grace.from(table).update({ owner_id: id.grace } as never).eq("owner_id", id.alex), `update ${table}`), table).toBe("42501");
    }
    expect(await sqlState(db.grace.from("support_shares").update({ stopped_at: new Date().toISOString() }).eq("researcher_id", id.alex), "share row")).toBe("42501");
    expect(await records("alex")).toEqual(before);
    expect(await canReadResearcher(db.grace, id.alex)).toBe(true);

    // Stopping denies every admin's very next read, of every area.
    await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    expect(await canReadResearcher(db.grace, id.alex)).toBe(false);
    expectNothing(await records("grace"), "stopped");
    expectNothing(await records("noah"), "stopped");
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
    await ok(db.alex.rpc("share_with_team"), "share");
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
      await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    }
  });
});

describe("researchers never learn which admin it is", () => {
  it("no read a researcher can make returns an admin's name or email", async () => {
    // Grace made records a researcher could reach: peptides, a sale to Alex's account, an invitation.
    await ok(db.alex.rpc("share_with_team"), "share");
    try {
      const admins = [people.grace, people.noah];
      const reads: [string, PromiseLike<{ data: unknown; error: { code?: string } | null }>][] = [
        ["support_shares", db.alex.from("support_shares").select("*")],
        ["share_with_team", db.alex.rpc("share_with_team")],
        ["profiles", db.alex.from("profiles").select("*")],
        ["peptides", db.alex.from("peptides").select("*")],
        ["cycle_templates", db.alex.from("cycle_templates").select("*")],
        ["can_read_researcher", db.alex.rpc("can_read_researcher", { p_owner: id.grace })],
        ...RESEARCHER_TABLES.map((table) => [table, db.alex.from(table).select("*")] as [string, PromiseLike<{ data: unknown; error: { code?: string } | null }>]),
      ];
      const seen: unknown[] = [await listShareHistory(db.alex, id.alex), await readResearcherRecords(db.alex, id.alex), await viewInvitation(alex.inviteToken)];
      for (const [what, call] of reads) {
        const { data, error } = await call;
        expect(error, what).toBeNull();
        seen.push(data);
      }
      const payload = JSON.stringify(seen);
      for (const admin of admins) {
        expect(payload, admin.name).not.toContain(admin.name);
        expect(payload, admin.email).not.toContain(admin.email);
      }
      // What names people is for admins only: refused to a researcher, or empty under RLS.
      for (const fn of [
        "admin_support_researchers",
        "business_buyer_accounts",
        "business_sellers",
        "admin_business_seller_totals",
        "admin_business_outside_buyers",
        "admin_business_stock",
        "admin_library_peptides",
      ] as const) {
        expect(await sqlState(db.alex.rpc(fn), fn), fn).toBe("42501");
      }
      expect(await sqlState(db.alex.rpc("resend_invitation", { p_id: randomUUID(), p_token_hash: "x" }), "resend_invitation")).toBe("42501");
      for (const table of ["invitations", "business_sales", "business_purchases", "support_grants"] as const) {
        const { data, error } = await db.alex.from(table).select("*");
        expect(error ? error.code : data, table).toEqual(error ? "42501" : []);
      }
      // S4's readers that named admins are gone.
      for (const fn of ["support_admins", "support_grant_history"]) {
        const { error } = await (db.alex.rpc as unknown as (name: string) => PromiseLike<{ error: { code?: string } | null }>)(fn);
        expect(error?.code, fn).toBe("PGRST202");
      }
    } finally {
      await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    }
  });
});
