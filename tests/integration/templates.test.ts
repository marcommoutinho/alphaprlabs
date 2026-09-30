// S8 cycle templates (A3, V7 D7) against the real local Supabase (npm run db:start):
// admin-only writes through admin_save_template() (save_cycle_template's
// rules, no longer an API itself), every rule re-checked in the database,
// unavailable peptides refused, "updated" moving only on a real change,
// concurrent saves over one version: one commits, the other is refused
// (AP038), never a mix; the action replaying a committed save and refusing a
// stale one as changed whatever changed since; library reference counts counting
// templates, the read rule (admins and acknowledged researchers), and the
// admin-only server action. No mocked database: the action runs as the
// signed-in person, only its cookie session is swapped for a signed-in client.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { savePeptideAs, saveTemplateAs } from "../support/admin-writers";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const { saveTemplateAction } = await import("@/app/(private)/admin/library/templates/actions");

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s8-tpl-admin"), name: "S8 Template Admin" };
const second = { email: uniqueEmail("s8-tpl-second"), name: "S8 Second Admin" };
const newAdmin = { email: uniqueEmail("s8-tpl-new-admin"), name: "S8 Unacknowledged Admin" };
const researcher = { email: uniqueEmail("s8-tpl-researcher"), name: "S8 Template Researcher" };
const newResearcher = { email: uniqueEmail("s8-tpl-new"), name: "S8 Unacknowledged Researcher" };

const tag = () => randomBytes(4).toString("hex");
let adminDb: Client;
let secondDb: Client;
const peptide = { a: "", b: "", withdrawn: "" };

async function createPeptide(name: string, available = true) {
  return ok(
    savePeptideAs(adminDb, {
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
  await ensureAccount({ ...second, role: "admin" });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
  adminDb = await signedInClient(admin.email);
  secondDb = await signedInClient(second.email);
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
const save = (db: Client, name: string, plans?: unknown, id?: string) => saveTemplateAs(db, args(name, plans, id));
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
    const id = await ok(saveTemplateAs(adminDb, { ...args(`  ${name} `), p_guidance: " Guidance. " }), "create");
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
    expect(await ok(saveTemplateAs(adminDb, { ...args(name, same, id!), p_guidance: "Guidance." }), "resave")).toBe(id);
    expect(await stored(id!)).toEqual(first);

    // A real change moves "updated".
    await new Promise((resolve) => setTimeout(resolve, 20));
    const changed = [{ peptide_id: peptide.a, phases: [interval(1, 29, "0.45"), pause(30), interval(37, 47, "0.6")] }, recompPlans()[1]];
    expect(await ok(save(adminDb, name, changed, id!), "edit")).toBe(id);
    const edited = await stored(id!);
    expect(edited.plans[0].phases[0].dose_mg).toBe("0.45");
    expect(new Date(edited.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());

    // Editing a template that does not exist is refused (P0002) and creates nothing.
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await sqlState(save(adminDb, name, recompPlans(), missing), "edit missing")).toBe("P0002");
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
      savePeptideAs(adminDb, {
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
  it("two saves over the same version at once: exactly one commits, the other is refused (AP038), never a mix", async () => {
    const name = `Concurrent ${tag()}`;
    const id = (await create(name))!;
    const versionA = [{ peptide_id: peptide.a, phases: [interval(0, 10, "1"), pause(10), interval(17, 10, "1")] }];
    const versionB = [
      { peptide_id: peptide.b, phases: [weekdays(0, 20, [2, 4])] },
      { peptide_id: peptide.a, phases: [interval(5, 3, "2")] },
    ];
    const otherTab = await signedInClient(admin.email);
    for (let round = 0; round < 8; round++) {
      const [{ version }] = await ok(serviceClient().from("cycle_templates").select("version").eq("id", id), "version");
      // Both opened at the same version; each round's names differ, so each save is a change.
      const attempt = (db: Client, label: string, plans: unknown) =>
        db.rpc("admin_save_template", {
          p_request_key: randomUUID(),
          p_request_hash: randomBytes(32).toString("hex"),
          p_id: id,
          p_expected_version: version,
          p_name: `${name} ${label}${round}`,
          p_guidance: "",
          p_plans: plans as Json,
        } as never);
      const results = await Promise.all([attempt(adminDb, "A", versionA), attempt(otherTab, "B", versionB)]);
      expect(results.map((result) => result.error?.code ?? "ok").sort()).toEqual(["AP038", "ok"]);
      const winner = results[0].error ? "B" : "A";
      const now = await stored(id);
      expect(now.name).toBe(`${name} ${winner}${round}`);
      const shape = now.plans.map((plan) => `${plan.peptide_id}:${plan.phases.map((phase) => phase.offset_days).join(",")}`).join("|");
      expect(shape).toBe(winner === "A" ? `${peptide.a}:0,10,17` : `${peptide.b}:0|${peptide.a}:5`);
      expect(Number((await ok(serviceClient().from("cycle_templates").select("version").eq("id", id), "after"))[0].version)).toBe(Number(version) + 1);
    }
  });
});

describe("the D7 save action (server)", () => {
  const phase = { kind: "active", day: "1", len: "28", mg: "0.4", time: "08:00", schedule: "interval", every: "5", days: [1, 3, 5] };
  const key = () => crypto.randomUUID();
  const versionOf = async (id: string) => Number((await ok(serviceClient().from("cycle_templates").select("version").eq("id", id), "version"))[0].version);

  it("an admin saves through the action; validation returns the designed messages", async () => {
    acting.client = adminDb;
    const name = `Action ${tag()}`;
    const form = { id: null, version: null, name, guidance: "", plans: [{ peptideId: peptide.a, phases: [phase] }], publish: false };
    expect(await saveTemplateAction({ ...form, name: " ", requestKey: key() })).toMatchObject({ error: "Name is required." });
    // Draft and publish run the same rules.
    expect(await saveTemplateAction({ ...form, name: " ", publish: true, requestKey: key() })).toMatchObject({ error: "Name is required." });
    expect(await saveTemplateAction({ ...form, plans: [], requestKey: key() })).toMatchObject({ error: "Add at least one peptide — an empty template can't be saved." });
    const [{ name: withdrawnName }] = await ok(serviceClient().from("peptides").select("name").eq("id", peptide.withdrawn), "name");
    expect(await saveTemplateAction({ ...form, plans: [{ peptideId: peptide.withdrawn, phases: [phase] }], requestKey: key() })).toMatchObject({
      error: `${withdrawnName} is no longer offered, so it can't be added. Remove it before saving.`,
    });
    const [{ name: aName }] = await ok(serviceClient().from("peptides").select("name").eq("id", peptide.a), "name");
    expect(
      await saveTemplateAction({ ...form, plans: [{ peptideId: peptide.a, phases: [{ ...phase, mg: "" }, { ...phase, kind: "break", day: "20" }] }], requestKey: key() }),
    ).toMatchObject({ error: `${aName}, phase 1: enter a dose above 0 mg. (+1 more)` });
    // Without a request key or a state, or with an id but no version, nothing is read or saved.
    expect(await saveTemplateAction(form)).toMatchObject({ error: "This template could not be saved. Reload the page and try again." });
    const stateless = Object.fromEntries(Object.entries(form).filter(([field]) => field !== "publish"));
    expect(await saveTemplateAction({ ...stateless, requestKey: key() })).toMatchObject({ error: "This template could not be saved. Reload the page and try again." });
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "none yet")).toEqual([]);

    // A new template saved as a draft.
    const createKey = key();
    const created = await saveTemplateAction({ ...form, requestKey: createKey });
    expect(created).toMatchObject({ saved: { version: 1, published: false }, toast: `Draft saved · ${name}. Researchers can't see it.` });
    const id = created.saved!.id;
    // The same request again replays; no second template.
    expect(await saveTemplateAction({ ...form, requestKey: createKey })).toMatchObject({ saved: { id, version: 1 } });
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "one")).toEqual([{ id }]);

    // Published with an edit: one version; then saved again as published.
    expect(await saveTemplateAction({ ...form, id, version: 1, guidance: "More.", publish: true, requestKey: key() })).toMatchObject({
      saved: { id, version: 2, published: true },
      toast: `${name} published. Researchers can see it now.`,
    });
    expect((await stored(id)).guidance).toBe("More.");
    expect(await saveTemplateAction({ ...form, id, version: 2, guidance: "More.", publish: true, requestKey: key() })).toMatchObject({
      saved: { id, version: 2, published: true },
      toast: "Template updated for future copies. Existing cycles unchanged.",
    });
    // Saving over the version it was opened at when someone saved since: refused, says who.
    expect(await saveTemplateAction({ ...form, id, version: 1, guidance: "Stale.", requestKey: key() })).toEqual({
      changed: true,
      error: `Changed by ${admin.name} since you opened it. Nothing was saved.`,
    });
    expect((await stored(id)).guidance).toBe("More.");
    expect(await saveTemplateAction({ ...form, id: "00000000-0000-4000-8000-000000000000", version: 1, requestKey: key() })).toEqual({
      gone: true,
      error: "This template no longer exists. The list has been refreshed.",
    });
  });

  it("an admin saves an edit of a template that names a peptide withdrawn since (Marco, 2026-09-26)", async () => {
    acting.client = adminDb;
    const t = tag();
    const later = await createPeptide(`Action withdrawn ${t}`);
    const name = `Action keeps ${t}`;
    const id = await create(name, [{ peptide_id: later, phases: [interval(0, 28)] }]);
    expect(await ok(serviceClient().from("peptides").update({ available: false }).eq("id", later).select("id"), "withdraw")).toHaveLength(1);
    const form = { id, version: await versionOf(id!), name, guidance: "", plans: [{ peptideId: later, phases: [{ ...phase, mg: "0.5" }] }], publish: true };
    expect(await saveTemplateAction({ ...form, requestKey: key() })).toMatchObject({
      saved: { id },
      toast: "Template updated for future copies. Existing cycles unchanged.",
    });
    expect((await stored(id!)).plans.map((plan) => plan.peptide_id)).toEqual([later]);
  });

  // The database answers a replay and a stale version before any rule that depends on the library now.
  it("a committed save naming a withdrawn peptide, retried after another save removed it, replays", async () => {
    acting.client = adminDb;
    const t = tag();
    const later = await createPeptide(`Replay withdrawn ${t}`);
    const name = `Replay keeps ${t}`;
    const id = (await create(name, [{ peptide_id: later, phases: [interval(0, 28)] }, recompPlans()[1]]))!;
    expect(await ok(serviceClient().from("peptides").update({ available: false }).eq("id", later).select("id"), "withdraw")).toHaveLength(1);
    const opened = await versionOf(id);
    const kept = { peptideId: later, phases: [{ ...phase, mg: "0.5" }] };
    const b = { peptideId: peptide.b, phases: [phase] };
    const form = { id, version: opened, name, guidance: "Kept.", plans: [kept, b], publish: true };
    const requestKey = key();
    // Committed; its answer never reached the editor.
    expect(await saveTemplateAction({ ...form, requestKey })).toMatchObject({ saved: { id, version: opened + 1 } });
    // Another admin removes the withdrawn peptide.
    acting.client = secondDb;
    expect(await saveTemplateAction({ ...form, version: opened + 1, guidance: "Removed.", plans: [b], requestKey: key() })).toMatchObject({ saved: { id, version: opened + 2 } });
    // The retry of the first save, same key and details: its answer, nothing written.
    acting.client = adminDb;
    expect(await saveTemplateAction({ ...form, requestKey })).toMatchObject({
      saved: { id, version: opened + 1 },
      toast: "Template updated for future copies. Existing cycles unchanged.",
    });
    expect(await stored(id)).toMatchObject({ guidance: "Removed.", plans: [{ peptide_id: peptide.b }] });
    expect(await versionOf(id)).toBe(opened + 2);
  });

  it("a stale save that the library no longer allows is refused as changed (AP038), not as invalid", async () => {
    acting.client = adminDb;
    const t = tag();
    const later = await createPeptide(`Stale withdrawn ${t}`);
    const name = `Stale keeps ${t}`;
    const id = (await create(name, [{ peptide_id: later, phases: [interval(0, 28)] }, recompPlans()[1]]))!;
    const opened = await versionOf(id);
    const kept = { peptideId: later, phases: [{ ...phase, mg: "0.5" }] };
    const b = { peptideId: peptide.b, phases: [phase] };
    // Withdrawn, then another admin removes it from the template.
    expect(await ok(serviceClient().from("peptides").update({ available: false }).eq("id", later).select("id"), "withdraw")).toHaveLength(1);
    acting.client = secondDb;
    expect(await saveTemplateAction({ id, version: opened, name, guidance: "", plans: [b], publish: true, requestKey: key() })).toMatchObject({ saved: { id } });
    // The first admin's editor, still at the version it opened, still naming it.
    acting.client = adminDb;
    expect(await saveTemplateAction({ id, version: opened, name, guidance: "Mine.", plans: [kept, b], publish: true, requestKey: key() })).toEqual({
      changed: true,
      error: `Changed by ${second.name} since you opened it. Nothing was saved.`,
    });
    // At the current version the same content is refused for what it is.
    const [{ name: laterName }] = await ok(serviceClient().from("peptides").select("name").eq("id", later), "name");
    expect(await saveTemplateAction({ id, version: opened + 1, name, guidance: "Mine.", plans: [kept, b], publish: true, requestKey: key() })).toMatchObject({
      error: `${laterName} is no longer offered, so it can't be added. Remove it before saving.`,
    });
    expect(await stored(id)).toMatchObject({ guidance: "", plans: [{ peptide_id: peptide.b }] });
  });

  it("a researcher calling the action is refused before anything is saved", async () => {
    acting.client = await signedInClient(researcher.email);
    const name = `Researcher action ${tag()}`;
    await expect(
      saveTemplateAction({ id: null, version: null, name, guidance: "", plans: [{ peptideId: peptide.a, phases: [phase] }], publish: true, requestKey: key() }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "none")).toEqual([]);
  });
});
