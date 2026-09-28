// S9 cycles against the real local Supabase (npm run db:start): a
// multi-peptide cycle saved as revision 1; a template copy that later
// template edits never change (the handoff scenario) with the template
// snapshot and admin-only counts; editing as the next revision through the
// server action, with the earlier revision kept and only future doses
// changed; and save_cycle() re-checking every structural rule itself. No
// mocked database: the action runs as the signed-in person, only its cookie
// session is swapped for a signed-in client.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { editWindow } from "@/lib/cycles/revise";
import { formFromTemplate, formOfCycle, validateCycle } from "@/lib/cycles/rules";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import { getCycle, listCyclePeptides, plansArgument } from "@/lib/cycles/service";
import { localDateOf } from "@/lib/schedule/zone";
import {
  type Client,
  createCycle,
  createPeptide,
  day,
  interval,
  pause,
  plan,
  saveCycle,
  tag,
  TORONTO,
  weekdays,
} from "../support/cycles";
import { ensureAccount, ok, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const { saveCycleAction } = await import("@/app/(private)/app/cycles/actions");

const admin = { email: uniqueEmail("s9-cyc-admin"), name: "S9 Cycles Admin" };
const alex = { email: uniqueEmail("s9-cyc-alex"), name: "S9 Alex" };
let adminDb: Client;
let alexDb: Client;
const peptide = { a: "", b: "", c: "" };

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...alex, role: "researcher" });
  adminDb = await signedInClient(admin.email);
  alexDb = await signedInClient(alex.email);
  const t = tag();
  peptide.a = await createPeptide(adminDb, `Cycle A ${t}`);
  peptide.b = await createPeptide(adminDb, `Cycle B ${t}`);
  peptide.c = await createPeptide(adminDb, `Cycle C ${t}`);
});

describe("creating a cycle", () => {
  it("stores a multi-peptide cycle as revision 1, with exact decimals and the named time zone", async () => {
    const id = await createCycle(alexDb, {
      name: " Recomp Spring 26 ",
      baseline: "82.4 kg",
      timeZone: "Europe/Lisbon",
      plans: [
        plan(peptide.a, [interval(day(1), day(29), "0.40", 5, "20:00"), pause(day(30), day(36)), interval(day(37), day(60), "0.6")]),
        plan(peptide.b, [weekdays(day(1), day(40), [1, 3, 5], "0.125")]),
      ],
    });
    const cycle = await getCycle(alexDb, id);
    expect(cycle).toMatchObject({ name: "Recomp Spring 26", goal: "Recomposition", baseline: "82.4 kg", templateId: null, currentRevision: 1 });
    expect(cycle!.revisions).toHaveLength(1);
    const [revision] = cycle!.revisions;
    expect(revision.timeZone).toBe("Europe/Lisbon");
    expect(revision.plans.map((p) => [p.peptideId, p.effectiveFrom, p.phases.length])).toEqual([
      [peptide.a, null, 3],
      [peptide.b, null, 1],
    ]);
    expect(revision.plans[0].phases[0]).toMatchObject({ kind: "active", doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 5 } });
    expect(revision.plans[1].phases[0]).toMatchObject({ doseMg: "0.125", schedule: { type: "weekdays", days: [1, 3, 5] } });
    // Plan and phase ids are uuids: occurrence keys are planId:phaseId:(index|date).
    const [first] = cycleOccurrences(cycle!.revisions);
    expect(first.key).toMatch(/^[0-9a-f-]{36}:[0-9a-f-]{36}:(0|\d{4}-\d{2}-\d{2})$/);
  });

  it("refuses every invalid cycle in the database, whatever the app sends", async () => {
    const a = (phases: Record<string, unknown>[]) => [plan(peptide.a, phases)];
    const ok1 = interval(day(1), day(10));
    const invalid: [string, Parameters<typeof saveCycle>[1]][] = [
      ["blank name", { name: " \t", plans: a([ok1]) }],
      ["blank goal", { goal: " ", plans: a([ok1]) }],
      ["unknown time zone", { timeZone: "Mars/Olympus", plans: a([ok1]) }],
      ["POSIX zone", { timeZone: "XYZ+3", plans: a([ok1]) }],
      ["no peptides", { plans: [] }],
      ["repeated peptide", { plans: [...a([ok1]), ...a([interval(day(20), day(30))])] }],
      ["ends before it starts", { plans: a([interval(day(10), day(1))]) }],
      ["before 2000", { plans: a([interval("1999-12-31", day(1))]) }],
      ["longer than 3660 days", { plans: a([interval(day(1), day(3661))]) }],
      ["dose 0", { plans: a([interval(day(1), day(10), "0")]) }],
      ["dose with an exponent", { plans: a([interval(day(1), day(10), "1e3")]) }],
      ["dose as a number", { plans: a([{ ...ok1, dose_mg: 0.4 }]) }],
      ["every 366 days", { plans: a([interval(day(1), day(10), "0.4", 366)]) }],
      ["no weekdays", { plans: a([weekdays(day(1), day(10), [])]) }],
      ["unsorted weekdays", { plans: a([weekdays(day(1), day(10), [5, 1])]) }],
      ["time 24:00", { plans: a([{ ...ok1, local_time: "24:00" }]) }],
      ["overlapping phases", { plans: a([ok1, pause(day(10), day(12))]) }],
      ["no active phase", { plans: a([pause(day(1), day(5))]) }],
      ["an impossible date", { plans: a([interval("2026-02-30", day(10))]) }],
      ["a phase id on a new cycle", { plans: a([{ ...ok1, phase_id: "00000000-0000-4000-8000-000000000001" }]) }],
      ["a plan id on a new cycle", { plans: [plan(peptide.a, [ok1], "00000000-0000-4000-8000-000000000001")] }],
      ["an effective date on a new cycle", { plans: [plan(peptide.a, [ok1], null, day(0))] }],
      ["a version on a new cycle", { plans: a([ok1]), version: 1 }],
      ["a dose change before its phase", { plans: a([{ ...ok1, dose_changes: [{ from: day(0), dose_mg: "1" }] }]) }],
    ];
    for (const [label, args] of invalid) {
      expect(await sqlState(saveCycle(alexDb, args), label), label).toBe("22023");
    }
    const unknownPeptide = "00000000-0000-4000-8000-00000000abcd";
    expect(await sqlState(saveCycle(alexDb, { plans: [plan(unknownPeptide, [ok1])] }), "unknown peptide")).toBe("AP003");
    expect(await sqlState(saveCycle(alexDb, { plans: a([ok1]), templateId: unknownPeptide }), "unknown template")).toBe("AP008");
  });
});

describe("a template copy is a snapshot (handoff: edit the template → the existing cycle is unchanged)", () => {
  it("keeps the copied plan and the template's name, guidance and version when the admin edits the template", async () => {
    const t = tag();
    const templatePlans = [
      {
        peptide_id: peptide.a,
        phases: [
          { kind: "active", offset_days: 0, length_days: 29, dose_mg: "0.4", local_time: "20:00", schedule_type: "interval", every_days: 5 },
          { kind: "break", offset_days: 29, length_days: 7 },
        ],
      },
      { peptide_id: peptide.b, phases: [{ kind: "active", offset_days: 0, length_days: 40, dose_mg: "0.3", local_time: "07:30", schedule_type: "weekdays", weekdays: [1, 3, 5] }] },
    ];
    const name = `Recomp starter ${t}`;
    const templateId = (await ok(adminDb.rpc("save_cycle_template", { p_name: name, p_guidance: "Cycle off after.", p_plans: templatePlans }), "template"))!;
    const [template] = await ok(adminDb.from("cycle_templates").select("updated_at").eq("id", templateId), "template version");

    // The researcher's copy, through the builder's rules and the server action.
    acting.client = alexDb;
    const peptides = await listCyclePeptides(alexDb);
    const form = { ...formFromTemplate({ id: templateId, name, plans: [
      { peptideId: peptide.a, phases: [{ kind: "active" as const, offset: 0, len: 29, doseMg: "0.4", time: "20:00", schedule: { type: "interval" as const, everyDays: 5 } }, { kind: "break" as const, offset: 29, len: 7 }] },
      { peptideId: peptide.b, phases: [{ kind: "active" as const, offset: 0, len: 40, doseMg: "0.3", time: "07:30", schedule: { type: "weekdays" as const, days: [1, 3, 5] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] } }] },
    ] }, day(1), TORONTO), goal: "Recomp" };
    expect(validateCycle(form, peptides).ok).toBe(true);
    const saved = await saveCycleAction(form);
    expect(saved).toMatchObject({ saved: true, message: "Cycle saved.", cycleId: expect.any(String) });
    const before = await getCycle(alexDb, saved.cycleId!);
    expect(before).toMatchObject({ templateId, templateName: name, templateGuidance: "Cycle off after.", templateUpdatedAt: template.updated_at });
    expect(before!.revisions[0].plans[0].phases.map((p) => [p.kind, p.start, p.end])).toEqual([
      ["active", day(1), day(29)],
      ["break", day(30), day(36)],
    ]);

    // The admin edits the template: new name and guidance, a new dose, a peptide removed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const edited = [{ ...templatePlans[0], phases: [{ ...templatePlans[0].phases[0], dose_mg: "0.9" }, templatePlans[0].phases[1]] }];
    await ok(adminDb.rpc("save_cycle_template", { p_id: templateId, p_name: `${name} v2`, p_guidance: "Changed.", p_plans: edited }), "edit template");

    expect(await getCycle(alexDb, saved.cycleId!)).toEqual(before);

    // A3 counts the copy; only admins can ask, and learn a number only.
    const usage = await ok(adminDb.rpc("admin_cycle_template_usage").eq("template_id", templateId), "usage");
    expect(usage).toEqual([{ template_id: templateId, cycle_count: 1 }]);
    expect(await sqlState(alexDb.rpc("admin_cycle_template_usage"), "usage as researcher")).toBe("42501");
  });
});

describe("editing a cycle: the next revision, future doses only", () => {
  it("keeps revision 1, changes doses from tomorrow (today's is already due), and refuses a stale or past-changing save", async () => {
    // Daily at 00:00 from ten days ago: today's dose is always already due.
    const id = await createCycle(alexDb, {
      plans: [plan(peptide.c, [interval(day(-10), day(20), "1", 1, "00:00"), pause(day(21), day(27))]), plan(peptide.a, [interval(day(5), day(12))])],
    });
    const original = (await getCycle(alexDb, id))!;
    const now = new Date();
    const { effective } = editWindow(original.revisions, now);
    const form = formOfCycle(original, effective, localDateOf(now, TORONTO));
    form.plans[0].phases[0].mg = "1.5";
    form.name = "Renamed";

    acting.client = alexDb;
    expect(await saveCycleAction(form)).toMatchObject({ saved: true, message: "Future plan updated. Recorded history is unchanged.", cycleId: form.cycleId });
    const edited = (await getCycle(alexDb, id))!;
    expect(edited).toMatchObject({ name: "Renamed", currentRevision: 2 });
    expect(edited.revisions[0]).toEqual(original.revisions[0]);
    const [c, a] = edited.revisions[1].plans;
    expect(c.effectiveFrom).toBe(day(1));
    expect(c.phases[0]).toMatchObject({ id: original.revisions[0].plans[0].phases[0].id, start: day(-10), doseMg: "1", doseChanges: [{ from: day(1), doseMg: "1.5" }] });
    expect(a.phases).toEqual(original.revisions[0].plans[1].phases);

    const keysBefore = cycleOccurrences(original.revisions).map((o) => `${o.key} ${o.scheduledAt}`);
    const after = cycleOccurrences(edited.revisions);
    expect(after.map((o) => `${o.key} ${o.scheduledAt}`)).toEqual(keysBefore);
    expect(after.filter((o) => o.planId === c.planId && o.localDate <= day(0)).every((o) => o.doseMg === "1")).toBe(true);
    expect(after.filter((o) => o.planId === c.planId && o.localDate >= day(1)).every((o) => o.doseMg === "1.5")).toBe(true);

    // The form the edit started from is now stale.
    expect(await saveCycleAction(form)).toEqual({ errors: ["This cycle was changed elsewhere. Reload the page to see the latest plan."] });

    // A name-only save adds no revision.
    const again = formOfCycle(edited, editWindow(edited.revisions, now).effective, localDateOf(now, TORONTO));
    expect(await saveCycleAction({ ...again, goal: "New goal" })).toMatchObject({ saved: true });
    expect(await getCycle(alexDb, id)).toMatchObject({ goal: "New goal", currentRevision: 2, version: 3 });

    // The database refuses what the app would never send.
    const current = plansArgument(edited.revisions[1].plans.map((p) => ({ ...p, effectiveFrom: day(1) }))) as Record<string, unknown>[];
    const base = { cycleId: id, version: 3, plans: current };
    const moved = structuredClone(current) as { phases: Record<string, unknown>[] }[];
    moved[0].phases[0].start_date = day(-9);
    expect(await sqlState(saveCycle(alexDb, { ...base, plans: moved }), "moved start")).toBe("AP009");
    const early = structuredClone(current) as { effective_from: string }[];
    early[0].effective_from = day(-1);
    expect(await sqlState(saveCycle(alexDb, { ...base, plans: early }), "effective yesterday")).toBe("AP009");
    expect(await sqlState(saveCycle(alexDb, { ...base, plans: [current[1]] }), "dropping a started peptide")).toBe("AP009");
    const backdated = structuredClone(current) as { phases: Record<string, unknown>[] }[];
    backdated[1].phases.push(pause(day(-3), day(-2)));
    expect(await sqlState(saveCycle(alexDb, { ...base, plans: backdated }), "new phase in the past")).toBe("AP009");
    expect(await sqlState(saveCycle(alexDb, { ...base, version: 2 }), "stale")).toBe("AP010");
    expect(await sqlState(saveCycle(alexDb, { ...base, templateId: peptide.a }), "template on edit")).toBe("22023");
    const foreign = structuredClone(current) as { phases: Record<string, unknown>[] }[];
    foreign[1].phases[0].phase_id = original.revisions[0].plans[0].phases[1].id;
    expect(await sqlState(saveCycle(alexDb, { ...base, plans: foreign }), "another plan's phase id")).toBe("22023");
    expect((await getCycle(alexDb, id))!.currentRevision).toBe(2);
  });

  it("shows the designed messages, in order, from the server action", async () => {
    acting.client = alexDb;
    const result = await saveCycleAction({ cycleId: null, version: null, templateId: null, name: "", timeZone: TORONTO, goal: "", baseline: "", plans: [] });
    expect(result).toEqual({ errors: ["Give the cycle a name.", "Add a goal — results are reviewed against it.", "Add at least one peptide."] });
  });
});
