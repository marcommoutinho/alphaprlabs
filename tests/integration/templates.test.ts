// S8 cycle templates (A3) against the real local Supabase (npm run db:start):
// admin-only writes through save_cycle_template(), every rule re-checked in
// the database, unavailable peptides refused, "updated" moving only on a real
// change, concurrent saves never mixing, library reference counts counting
// templates, the read rule (admins and acknowledged researchers), and the
// admin-only server action. No mocked database: the action runs as the
// signed-in person, only its cookie session is swapped for a signed-in client.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const { saveTemplateAction } = await import("@/app/(private)/admin/templates/actions");

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s8-tpl-admin"), name: "S8 Template Admin" };
const newAdmin = { email: uniqueEmail("s8-tpl-new-admin"), name: "S8 Unacknowledged Admin" };
const researcher = { email: uniqueEmail("s8-tpl-researcher"), name: "S8 Template Researcher" };
const newResearcher = { email: uniqueEmail("s8-tpl-new"), name: "S8 Unacknowledged Researcher" };

const tag = () => randomBytes(4).toString("hex");
let adminDb: Client;
const peptide = { a: "", b: "", withdrawn: "" };

async function createPeptide(name: string, available = true) {
  return ok(
    adminDb.rpc("save_library_peptide", {
      p_name: name,
      p_information: `[Supplied information for ${name}]`,
      p_cycling_off_guidance: "",
      p_supplement_guidance: "",
      p_available: available,
    }),
    `create ${name}`,
  );
}

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
  adminDb = await signedInClient(admin.email);
  const t = tag();
  peptide.a = await createPeptide(`Template A ${t}`);
  peptide.b = await createPeptide(`Template B ${t}`);
  peptide.withdrawn = await createPeptide(`Template withdrawn ${t}`, false);
});

const interval = (offset: number, len: number, dose = "0.4", every = 5) => ({
  kind: "active",
  offset_days: offset,
  length_days: len,
  dose_mg: dose,
  local_time: "20:00",
  schedule_type: "interval",
  every_days: every,
});
const weekdays = (offset: number, len: number, days: number[] = [1, 3, 5]) => ({
  kind: "active",
  offset_days: offset,
  length_days: len,
  dose_mg: "0.3",
  local_time: "07:30",
  schedule_type: "weekdays",
  weekdays: days,
});
const pause = (offset: number, len = 7) => ({ kind: "break", offset_days: offset, length_days: len });
const recompPlans = () => [
  { peptide_id: peptide.a, phases: [interval(1, 29), pause(30), interval(37, 47, "0.6")] },
  { peptide_id: peptide.b, phases: [weekdays(0, 40)] },
];
const args = (name: string, plans: unknown = recompPlans(), id?: string) => ({
  p_name: name,
  p_guidance: "",
  p_plans: plans as Json,
  ...(id ? { p_id: id } : {}),
});
const save = (db: Client, name: string, plans?: unknown, id?: string) => db.rpc("save_cycle_template", args(name, plans, id));
const create = async (name: string, plans?: unknown) => ok(save(adminDb, name, plans), `save ${name}`);

type StoredPhase = {
  kind: string;
  offset_days: number;
  length_days: number;
  dose_mg: string | null;
  local_time: string | null;
  schedule_type: string | null;
  every_days: number | null;
  weekdays: number[] | null;
};
type StoredTemplate = { name: string; guidance: string; updated_at: string; plans: { peptide_id: string; phases: StoredPhase[] }[] };

/** The stored template, its plans in order and phases by start day (secret key). */
async function stored(id: string): Promise<StoredTemplate> {
  const db = serviceClient();
  const [template] = await ok(db.from("cycle_templates").select("name, guidance, updated_at").eq("id", id), "read template");
  if (!template) throw new Error(`No template ${id}`);
  const plans: { peptide_id: string; cycle_template_phases: StoredPhase[] }[] = await ok(
    db
      .from("cycle_template_plans")
      .select("peptide_id, position, cycle_template_phases(kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays)")
      .eq("template_id", id)
      .order("position"),
    "read plans",
  );
  return {
    ...template,
    plans: plans.map((plan) => ({
      peptide_id: plan.peptide_id,
      phases: [...plan.cycle_template_phases].sort((x, y) => x.offset_days - y.offset_days),
    })),
  };
}

describe("admins create and edit templates in the database", () => {
  it("stores relative phases per peptide; updated moves only on a real change", async () => {
    const name = `Recomp starter ${tag()}`;
    const id = await ok(adminDb.rpc("save_cycle_template", { ...args(`  ${name} `), p_guidance: " Guidance. " }), "create");
    const first = await stored(id!);
    expect(first).toMatchObject({
      name,
      guidance: "Guidance.",
      plans: [
        {
          peptide_id: peptide.a,
          phases: [
            { kind: "active", offset_days: 1, length_days: 29, dose_mg: "0.4", local_time: "20:00", schedule_type: "interval", every_days: 5, weekdays: null },
            { kind: "break", offset_days: 30, length_days: 7, dose_mg: null, local_time: null, schedule_type: null, every_days: null },
            { kind: "active", offset_days: 37, length_days: 47, dose_mg: "0.6" },
          ],
        },
        { peptide_id: peptide.b, phases: [{ kind: "active", schedule_type: "weekdays", weekdays: [1, 3, 5], every_days: null }] },
      ],
    });

    // The same content again (phases in another order, a dose with a trailing
    // zero, fields a break doesn't use) changes nothing, not even "updated".
    const same = [
      { peptide_id: peptide.a, phases: [interval(37, 47, "0.60"), { ...pause(30), dose_mg: "9" }, interval(1, 29)] },
      { peptide_id: peptide.b, phases: [{ ...weekdays(0, 40), every_days: 3 }] },
    ];
    expect(await ok(adminDb.rpc("save_cycle_template", { ...args(name, same, id!), p_guidance: "Guidance." }), "resave")).toBe(id);
    expect(await stored(id!)).toEqual(first);

    // A real change moves "updated".
    await new Promise((resolve) => setTimeout(resolve, 20));
    const changed = [{ peptide_id: peptide.a, phases: [interval(1, 29, "0.45"), pause(30), interval(37, 47, "0.6")] }, recompPlans()[1]];
    expect(await ok(save(adminDb, name, changed, id!), "edit")).toBe(id);
    const edited = await stored(id!);
    expect(edited.plans[0].phases[0].dose_mg).toBe("0.45");
    expect(new Date(edited.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());

    // Editing a template that does not exist returns nothing and creates nothing.
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await ok(save(adminDb, name, recompPlans(), missing), "edit missing")).toBeNull();
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("id", missing), "read missing")).toEqual([]);
  });

  it("refuses every invalid template, even from an admin calling the database directly, and stores nothing", async () => {
    const name = `Guarded ${tag()}`;
    const id = await create(name);
    const before = await stored(id!);
    const a = (phases: unknown[]) => [{ peptide_id: peptide.a, phases }];
    const invalid: [string, string, unknown][] = [
      ["blank name", " \t", recompPlans()],
      ["no peptides", name, []],
      ["not a list", name, { peptide_id: peptide.a }],
      ["repeated peptide", name, [...a([interval(0, 7)]), ...a([interval(10, 7)])]],
      ["start day before 1", name, a([interval(-1, 7)])],
      ["zero length", name, a([interval(0, 0)])],
      ["ends after day 3660", name, a([interval(3600, 61)])],
      ["dose 0", name, a([interval(0, 7, "0")])],
      ["dose NaN", name, a([interval(0, 7, "NaN")])],
      ["dose with an exponent", name, a([interval(0, 7, "1e3")])],
      ["dose as a number", name, a([{ ...interval(0, 7), dose_mg: 0.4 }])],
      ["every 0 days", name, a([interval(0, 7, "0.4", 0)])],
      ["every 366 days", name, a([interval(0, 7, "0.4", 366)])],
      ["no weekdays", name, a([weekdays(0, 7, [])])],
      ["weekday 7", name, a([weekdays(0, 7, [7])])],
      ["unsorted weekdays", name, a([weekdays(0, 7, [5, 1])])],
      ["repeated weekday", name, a([weekdays(0, 7, [1, 1])])],
      ["no time", name, a([{ ...interval(0, 7), local_time: "" }])],
      ["time 24:00", name, a([{ ...interval(0, 7), local_time: "24:00" }])],
      ["unknown schedule", name, a([{ ...interval(0, 7), schedule_type: "daily" }])],
      ["unknown kind", name, a([{ ...pause(0), kind: "rest" }])],
      ["overlapping phases", name, a([interval(0, 10), pause(9)])],
      ["phases starting the same day", name, a([interval(0, 10), pause(0)])],
      ["no active phase", name, a([pause(0)])],
      ["no phases", name, a([])],
      ["fractional day", name, a([{ ...interval(0, 7), offset_days: 1.5 }])],
    ];
    for (const [label, badName, plans] of invalid) {
      expect(await sqlState(save(adminDb, badName, plans), label), `create: ${label}`).toBe("22023");
      expect(await sqlState(save(adminDb, badName, plans, id!), label), `edit: ${label}`).toBe("22023");
    }
    // A refused edit leaves the template exactly as it was; no refused create stored anything.
    expect(await stored(id!)).toEqual(before);
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "count")).toEqual([{ id }]);
    // Touching phases are fine: day 1–10, break day 11–17, day 18–24.
    expect(await sqlState(save(adminDb, name, a([interval(0, 10), pause(10), interval(17, 7)]), id!))).toBe("ok");
  });
});

describe("unavailable peptides", () => {
  it("can't be added to a new or existing template; a template that has one withdrawn later stays editable with it (Marco, 2026-09-26)", async () => {
    const withdrawnPlan = { peptide_id: peptide.withdrawn, phases: [interval(0, 7)] };
    expect(await sqlState(save(adminDb, `New ${tag()}`, [withdrawnPlan]))).toBe("AP007");
    const id = await create(`Existing ${tag()}`);
    expect(await sqlState(save(adminDb, "Existing", [...recompPlans(), withdrawnPlan], id!))).toBe("AP007");
    const unknown = { peptide_id: "00000000-0000-4000-8000-000000000000", phases: [interval(0, 7)] };
    expect(await sqlState(save(adminDb, `Unknown ${tag()}`, [unknown]))).toBe("AP003");

    // Withdraw a peptide the template already uses: nothing is rewritten.
    const t = tag();
    const later = await createPeptide(`Withdrawn later ${t}`);
    const name = `Uses a withdrawn peptide ${t}`;
    const kept = await create(name, [{ peptide_id: later, phases: [interval(0, 28)] }, recompPlans()[1]]);
    const before = await stored(kept!);
    await ok(
      adminDb.rpc("save_library_peptide", {
        p_id: later,
        p_name: `Withdrawn later ${t}`,
        p_information: `[Supplied information for Withdrawn later ${t}]`,
        p_cycling_off_guidance: "",
        p_supplement_guidance: "",
        p_available: false,
      }),
      "withdraw",
    );
    expect(await stored(kept!)).toEqual(before);
    // Saved again with it, and with its phases changed: kept.
    expect(await ok(save(adminDb, name, [{ peptide_id: later, phases: [interval(0, 21)] }, recompPlans()[1]], kept!), "keep it")).toBe(kept);
    expect((await stored(kept!)).plans.map((plan) => plan.peptide_id)).toEqual([later, peptide.b]);
    // Still never newly added: not to this template alongside it, nor to another one.
    const withBoth = [{ peptide_id: later, phases: [interval(0, 21)] }, recompPlans()[1], withdrawnPlan];
    expect(await sqlState(save(adminDb, name, withBoth, kept!))).toBe("AP007");
    expect(await sqlState(save(adminDb, "Existing", [...recompPlans(), { peptide_id: later, phases: [interval(0, 7)] }], id!))).toBe("AP007");
    // Once removed, it can't come back.
    const after = await stored(kept!);
    expect(await ok(save(adminDb, name, [recompPlans()[1]], kept!), "remove it")).toBe(kept);
    expect((await stored(kept!)).plans.map((plan) => plan.peptide_id)).toEqual([peptide.b]);
    expect(await sqlState(save(adminDb, name, after.plans.map((plan) => ({ peptide_id: plan.peptide_id, phases: [interval(0, 7)] })), kept!))).toBe(
      "AP007",
    );
  });
});

describe("library reference counts count templates", () => {
  it("counts distinct templates naming each entry, admin-only", async () => {
    const t = tag();
    const counted = await createPeptide(`Counted ${t}`);
    const count = async () =>
      ok(adminDb.rpc("library_reference_counts").eq("peptide_id", counted), "counts").then((rows) => rows);
    expect(await count()).toEqual([{ peptide_id: counted, template_count: 0, cycle_count: 0 }]);
    const plan = { peptide_id: counted, phases: [interval(0, 7), pause(7), interval(14, 7)] };
    const first = await create(`Counts one ${t}`, [plan]);
    await create(`Counts two ${t}`, [plan, recompPlans()[1]]);
    expect(await count()).toEqual([{ peptide_id: counted, template_count: 2, cycle_count: 0 }]);
    // Removing it from a template lowers the count.
    await ok(save(adminDb, `Counts one ${t}`, [recompPlans()[0]], first!), "remove");
    expect(await count()).toEqual([{ peptide_id: counted, template_count: 1, cycle_count: 0 }]);
    for (const other of [await signedInClient(researcher.email), anonClient()]) {
      expect(await sqlState(other.rpc("library_reference_counts"))).toBe("42501");
    }
  });
});

describe("reads: admins and acknowledged researchers; writes: admins through the function only", () => {
  const TABLES = ["cycle_templates", "cycle_template_plans", "cycle_template_phases"] as const;

  it("acknowledged researchers and admins (acknowledged or not) read every template; others read nothing", async () => {
    const id = await create(`Readable ${tag()}`);
    const { data: plans } = await serviceClient().from("cycle_template_plans").select("id").eq("template_id", id!);
    const planIds = plans!.map((plan) => plan.id);
    const readAll = async (db: Client) => ({
      templates: (await ok(db.from("cycle_templates").select("id").eq("id", id!), "templates")).length,
      plans: (await ok(db.from("cycle_template_plans").select("id").eq("template_id", id!), "plans")).length,
      phases: (await ok(db.from("cycle_template_phases").select("id").in("plan_id", planIds), "phases")).length,
    });
    const everything = { templates: 1, plans: 2, phases: 4 };
    expect(await readAll(adminDb)).toEqual(everything);
    expect(await readAll(await signedInClient(researcher.email))).toEqual(everything);
    expect(await readAll(await signedInClient(newAdmin.email))).toEqual(everything);
    expect(await readAll(await signedInClient(newResearcher.email))).toEqual({ templates: 0, plans: 0, phases: 0 });
    for (const table of TABLES) {
      expect(await sqlState(anonClient().from(table).select("id").limit(1)), `anon ${table}`).toBe("42501");
    }
  });

  it("researchers and anonymous callers cannot save; nobody writes the tables directly", async () => {
    const id = await create(`Protected ${tag()}`);
    const before = await stored(id!);
    for (const db of [await signedInClient(researcher.email), await signedInClient(newResearcher.email), anonClient()]) {
      expect(await sqlState(save(db, `Forged ${tag()}`))).toBe("42501");
      expect(await sqlState(save(db, "Forged", recompPlans(), id!))).toBe("42501");
      expect(await sqlState(db.rpc("admin_cycle_template_usage"))).toBe("42501");
    }
    // An unacknowledged admin maintains templates (the back office needs no acknowledgement).
    expect(await sqlState(save(await signedInClient(newAdmin.email), `By new admin ${tag()}`))).toBe("ok");

    for (const db of [adminDb, await signedInClient(researcher.email), serviceClient()]) {
      expect(await sqlState(db.from("cycle_templates").insert({ name: "Forged" }))).toBe("42501");
      expect(await sqlState(db.from("cycle_templates").update({ name: "Forged" }).eq("id", id!))).toBe("42501");
      expect(await sqlState(db.from("cycle_templates").delete().eq("id", id!))).toBe("42501");
      expect(await sqlState(db.from("cycle_template_plans").delete().eq("template_id", id!))).toBe("42501");
      expect(await sqlState(db.from("cycle_template_phases").update({ length_days: 1 }).gte("length_days", 1))).toBe("42501");
    }
    // Internal helper: not callable through the API.
    expect(await sqlState(adminDb.rpc("cycle_template_content", { p_template_id: id! }))).toBe("42501");
    expect(await stored(id!)).toEqual(before);
    expect(await ok(serviceClient().from("cycle_templates").select("id").like("name", "Forged%"), "forged")).toEqual([]);
  });

  it("cycle usage counts are admin-only, one row per template, 0 until cycles exist", async () => {
    const id = await create(`Usage ${tag()}`);
    expect(await ok(adminDb.rpc("admin_cycle_template_usage").eq("template_id", id!), "usage")).toEqual([{ template_id: id, cycle_count: 0 }]);
  });
});

describe("concurrent edits", () => {
  it("two saves of one template at once leave exactly one of them, never a mix", async () => {
    const name = `Concurrent ${tag()}`;
    const id = await create(name);
    const versionA = [{ peptide_id: peptide.a, phases: [interval(0, 10, "1"), pause(10), interval(17, 10, "1")] }];
    const versionB = [
      { peptide_id: peptide.b, phases: [weekdays(0, 20, [2, 4])] },
      { peptide_id: peptide.a, phases: [interval(5, 3, "2")] },
    ];
    for (let round = 0; round < 8; round++) {
      const results = await Promise.all([save(adminDb, `${name} A`, versionA, id!), save(await signedInClient(admin.email), `${name} B`, versionB, id!)]);
      for (const result of results) expect(result.error).toBeNull();
      const now = await stored(id!);
      const shape = now.plans.map((plan) => `${plan.peptide_id}:${plan.phases.map((phase) => phase.offset_days).join(",")}`).join("|");
      if (now.name === `${name} A`) expect(shape).toBe(`${peptide.a}:0,10,17`);
      else {
        expect(now.name).toBe(`${name} B`);
        expect(shape).toBe(`${peptide.b}:0|${peptide.a}:5`);
      }
    }
  });
});

describe("the A3 save action (server)", () => {
  const phase = { kind: "active", day: "1", len: "28", mg: "0.4", time: "08:00", schedule: "interval", every: "5", days: [1, 3, 5] };

  it("an admin saves through the action; validation returns the designed messages", async () => {
    acting.client = adminDb;
    const name = `Action ${tag()}`;
    const form = { id: null, name, guidance: "", plans: [{ peptideId: peptide.a, phases: [phase] }] };
    expect(await saveTemplateAction({ ...form, name: " " })).toEqual({ error: "Name is required." });
    expect(await saveTemplateAction({ ...form, plans: [] })).toEqual({ error: "Add at least one peptide — an empty template can't be saved." });
    const [{ name: withdrawnName }] = await ok(serviceClient().from("peptides").select("name").eq("id", peptide.withdrawn), "name");
    expect(await saveTemplateAction({ ...form, plans: [{ peptideId: peptide.withdrawn, phases: [phase] }] })).toEqual({
      error: `${withdrawnName} is no longer offered, so it can't be added. Remove it before saving.`,
    });
    const [{ name: aName }] = await ok(serviceClient().from("peptides").select("name").eq("id", peptide.a), "name");
    expect(
      await saveTemplateAction({ ...form, plans: [{ peptideId: peptide.a, phases: [{ ...phase, mg: "" }, { ...phase, kind: "break", day: "20" }] }] }),
    ).toEqual({ error: `${aName}, phase 1: enter a dose above 0 mg. (+1 more)` });
    expect(await saveTemplateAction(form)).toEqual({ saved: true, toast: "Template created.", tone: "info" });
    const [{ id }] = await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "created");
    expect(await saveTemplateAction({ ...form, id, guidance: "More." })).toEqual({
      saved: true,
      toast: "Template updated for future copies. Existing cycles unchanged.",
      tone: "info",
    });
    expect((await stored(id)).guidance).toBe("More.");
    expect(await saveTemplateAction({ ...form, id: "00000000-0000-4000-8000-000000000000" })).toEqual({
      toast: "This template no longer exists. The list has been refreshed.",
      tone: "error",
    });
  });

  it("an admin saves an edit of a template that names a peptide withdrawn since (Marco, 2026-09-26)", async () => {
    acting.client = adminDb;
    const t = tag();
    const later = await createPeptide(`Action withdrawn ${t}`);
    const name = `Action keeps ${t}`;
    const id = await create(name, [{ peptide_id: later, phases: [interval(0, 28)] }]);
    expect(await ok(serviceClient().from("peptides").update({ available: false }).eq("id", later).select("id"), "withdraw")).toHaveLength(1);
    const form = { id, name, guidance: "", plans: [{ peptideId: later, phases: [{ ...phase, mg: "0.5" }] }] };
    expect(await saveTemplateAction(form)).toEqual({
      saved: true,
      toast: "Template updated for future copies. Existing cycles unchanged.",
      tone: "info",
    });
    expect((await stored(id!)).plans.map((plan) => plan.peptide_id)).toEqual([later]);
  });

  it("a researcher calling the action is refused before anything is saved", async () => {
    acting.client = await signedInClient(researcher.email);
    const name = `Researcher action ${tag()}`;
    await expect(
      saveTemplateAction({ id: null, name, guidance: "", plans: [{ peptideId: peptide.a, phases: [phase] }] }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "none")).toEqual([]);
  });
});
