// V7 admin content (20260929110000_admin_content.sql) against the real local
// Supabase, through PostgREST as each signed-in person, as the app calls it:
// draft / publish (a draft is invisible to researchers through every path and
// can't be added to anything; publishing needs the research summary; entries
// saved before V7 are published; a published entry never goes back to
// draft), "Not offered" versus draft, compare-and-set on the version (AP038,
// naming who saved), idempotent replays by request key (AP005 for other
// details), admin-only writes and reads, and the template save rules.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { listCyclePeptides } from "@/lib/cycles/service";
import { getPeptideForDetail, listAvailablePeptides } from "@/lib/library/research";
import { adminPeptide, lastChange, listAdminPeptides } from "@/lib/library/service";
import type { Json } from "@/lib/supabase/database.types";
import { createCycle, createPeptide, day, interval, plan, saveCycle, setAvailable, tag, type Client } from "../support/cycles";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { saveTemplateAs } from "../support/admin-writers";

const admin = { email: uniqueEmail("v7-content-admin"), name: "Priya Content" };
const other = { email: uniqueEmail("v7-content-admin2"), name: "Owen Content" };
const researcher = { email: uniqueEmail("v7-content-researcher"), name: "V7 Content Researcher" };

let adminDb: Client;
let otherDb: Client;
let researcherDb: Client;
let researcherId: string;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...other, role: "admin" });
  researcherId = await ensureAccount({ ...researcher, role: "researcher" });
  [adminDb, otherDb, researcherDb] = await Promise.all([signedInClient(admin.email), signedInClient(other.email), signedInClient(researcher.email)]);
});

const hash = () => randomBytes(32).toString("hex");
type PeptideArgs = {
  p_request_key: string;
  p_request_hash: string;
  p_id: string | null;
  p_expected_version: number | null;
  p_name: string;
  p_short_description: string;
  p_vial_strengths_mg: string[];
  p_information: string;
  p_cycling_off_guidance: string;
  p_supplement_guidance: string;
  p_offered: boolean;
  p_publish: boolean;
};
const peptideArgs = (patch: Partial<PeptideArgs> = {}): PeptideArgs => ({
  p_request_key: randomUUID(),
  p_request_hash: hash(),
  p_id: null,
  p_expected_version: null,
  p_name: `V7 peptide ${tag()}`,
  p_short_description: "",
  p_vial_strengths_mg: [],
  p_information: "",
  p_cycling_off_guidance: "",
  p_supplement_guidance: "",
  p_offered: true,
  p_publish: false,
  ...patch,
});
// The generated types can't express the nullable arguments.
const savePeptide = (db: Client, args: PeptideArgs) => db.rpc("admin_save_peptide", args as never).single();
const stored = async (id: string) => (await ok(serviceClient().from("peptides").select("*").eq("id", id), "stored"))[0];

async function draft(patch: Partial<PeptideArgs> = {}) {
  const args = peptideArgs(patch);
  const saved = await ok(savePeptide(adminDb, args), "save draft");
  return { id: saved.peptide_id, name: args.p_name.trim(), args, saved };
}

describe("draft and publish", () => {
  it("entries saved before V7 (rows written without the new columns) are published; the columns agree", async () => {
    const [{ id: legacy }] = await ok(
      serviceClient().from("peptides").insert({ name: `V7 legacy ${tag()}`, information: "[Supplied information]", available: true }).select("id"),
      "pre-V7 style row",
    );
    expect(await stored(legacy)).toMatchObject({ published_at: expect.any(String), offered: true, available: true, version: 1 });
    // A published entry withdrawn is "Not offered", never a draft.
    await setAvailable(adminDb, legacy, (await stored(legacy)).name, false);
    expect(await stored(legacy)).toMatchObject({ published_at: expect.any(String), offered: false, available: false });
    // Every draft there is was saved as one through the V7 writer: nothing older became a draft.
    const drafts = await ok(serviceClient().from("peptides").select("id").is("published_at", null), "drafts");
    if (drafts.length) {
      const logged = await ok(
        serviceClient().from("admin_content_changes").select("target_id").eq("kind", "peptide").eq("published", false).in("target_id", drafts.map((row) => row.id)),
        "draft log",
      );
      expect(new Set(logged.map((row) => row.target_id))).toEqual(new Set(drafts.map((row) => row.id)));
    }
  });

  it("a draft is saved without a summary; publishing needs one, and a published entry never goes back", async () => {
    const d = await draft({ p_short_description: " Short. ", p_vial_strengths_mg: ["10", "0.25"] });
    expect(d.saved).toEqual({ peptide_id: d.id, version: 1, published: false, newly_published: false, replayed: false });
    expect(await stored(d.id)).toMatchObject({ published_at: null, available: false, short_description: "Short.", vial_strengths_mg: [0.25, 10] });
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_publish: true })), "publish blank")).toBe("22023");
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_publish: true })), "new published blank")).toBe("22023");
    const published = await ok(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_information: "Summary.", p_publish: true })), "publish");
    expect(published).toMatchObject({ version: 2, published: true, newly_published: true, replayed: false });
    // The summary refusal is marked for the app, which shows it on the field.
    const blank = await savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 2, p_name: d.name, p_publish: false }));
    expect(blank.error).toMatchObject({ code: "22023", hint: "summary_required" });
    const first = (await stored(d.id)).published_at;
    expect(await stored(d.id)).toMatchObject({ available: true, information: "Summary." });
    // Saving it as a "draft" again keeps it published (and needs the summary).
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 2, p_name: d.name, p_publish: false })), "unpublish blank")).toBe("22023");
    expect(await ok(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 2, p_name: d.name, p_information: "Edited.", p_publish: false })), "edit")).toMatchObject({
      published: true,
      newly_published: false,
    });
    expect(await stored(d.id)).toMatchObject({ published_at: first, available: true, version: 3 });
    // Not even the secret key can turn a published entry back into a draft.
    expect(await sqlState(serviceClient().from("peptides").update({ published_at: null }).eq("id", d.id), "back to draft")).toBe("22023");
  });

  it("refuses bad strengths and names, and a name another entry has (ignoring case and spaces)", async () => {
    const d = await draft();
    for (const strengths of [["0"], ["100000.001"], ["1.2345"], ["abc"], ["5", "5.0"], Array.from({ length: 13 }, (_, i) => String(i + 1))]) {
      expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_vial_strengths_mg: strengths })), strengths.join())).toBe("22023");
    }
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_name: " " })), "blank name")).toBe("22023");
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_name: `  ${d.name.toUpperCase()} ` })), "taken")).toBe("23505");
  });

  it("a draft is invisible to researchers and anonymous callers through every path", async () => {
    const d = await draft({ p_information: "Draft summary." });
    const researcherCycles = await ok(serviceClient().from("cycle_plans").select("id").eq("owner_id", researcherId).eq("peptide_id", d.id), "none");
    expect(researcherCycles).toEqual([]);
    expect(await ok(researcherDb.from("peptides").select("id").eq("id", d.id), "researcher")).toEqual([]);
    expect(await ok(researcherDb.from("peptides").select("id").ilike("name", d.name), "researcher")).toEqual([]);
    // Anonymous callers can't read the table at all.
    expect(await sqlState(anonClient().from("peptides").select("id").eq("id", d.id), "anonymous")).toBe("42501");
    for (const [who, db] of [
      ["researcher", researcherDb],
      ["anonymous", anonClient()],
    ] as const) {
      expect(await sqlState(db.rpc("admin_library_entries"), who)).toBe("42501");
      expect(await sqlState(db.rpc("admin_library_peptides"), who)).toBe("42501");
    }
    expect((await listAvailablePeptides(researcherDb)).map((p) => p.id)).not.toContain(d.id);
    expect(await getPeptideForDetail(researcherDb, researcherId, d.id)).toBeNull();
    expect((await listCyclePeptides(researcherDb)).map((p) => p.id)).not.toContain(d.id);
    // Admins' research side (they are researchers too) doesn't list it either; the admin path does.
    expect(await ok(adminDb.from("peptides").select("id").eq("id", d.id), "admin table read")).toEqual([]);
    expect((await listAdminPeptides(adminDb)).find((p) => p.id === d.id)).toMatchObject({ publishedAt: null, information: "Draft summary." });
  });

  it("a draft can't be added to a cycle, a template or a personal vial (the mixtures' check)", async () => {
    const d = await draft({ p_information: "Summary." });
    expect(await sqlState(saveCycle(researcherDb, { plans: [plan(d.id, [interval(day(1), day(20))])] }), "cycle")).toBe("AP007");
    expect(
      await sqlState(
        saveTemplateAs(adminDb, {
          p_name: `V7 draft template ${tag()}`,
          p_guidance: "",
          p_plans: [{ peptide_id: d.id, phases: [{ kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "08:00", schedule_type: "interval", every_days: 2 }] }] as Json,
        }),
        "template",
      ),
    ).toBe("AP007");
    await ok(researcherDb.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    expect(
      await sqlState(
        researcherDb.rpc("add_personal_vial", { p_request_key: randomUUID(), p_request_hash: hash(), p_label: "", p_peptide_id: d.id, p_strength_mg: "10" }),
        "vial",
      ),
    ).toBe("AP007");
    expect(await ok(serviceClient().from("personal_vials").select("id").eq("peptide_id", d.id), "no vial")).toEqual([]);
  });

  it("Not offered is not a draft: hidden from new cycles, kept where it is used", async () => {
    const d = await draft({ p_information: "Summary." });
    await ok(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_information: "Summary.", p_publish: true })), "publish");
    const cycleId = await createCycle(researcherDb, { plans: [plan(d.id, [interval(day(1), day(20))])] });
    await ok(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 2, p_name: d.name, p_information: "Summary.", p_offered: false, p_publish: true })), "not offered");
    expect(await stored(d.id)).toMatchObject({ published_at: expect.any(String), offered: false, available: false });
    // The researcher whose cycle uses it still opens it; nobody can newly add it.
    expect(await getPeptideForDetail(researcherDb, researcherId, d.id)).toMatchObject({ id: d.id, available: false });
    expect((await listAvailablePeptides(researcherDb)).map((p) => p.id)).not.toContain(d.id);
    expect(await sqlState(saveCycle(researcherDb, { plans: [plan(d.id, [interval(day(30), day(40))])] }), "new cycle")).toBe("AP007");
    expect(cycleId).toBeTruthy();
    expect(await adminPeptide(adminDb, d.id)).toMatchObject({ offered: false, cycleCount: 1 });
  });
});

describe("compare-and-set and replays", () => {
  it("a save over an older version is refused (AP038) and says who saved since", async () => {
    const d = await draft();
    await ok(savePeptide(otherDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_short_description: "Owen's." })), "other saves");
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_short_description: "Mine." })), "stale")).toBe("AP038");
    expect(await stored(d.id)).toMatchObject({ short_description: "Owen's.", version: 2 });
    expect(await lastChange(adminDb, "peptide", d.id)).toMatchObject({ version: 2, changedBy: other.name });
    // An entry that isn't there.
    expect(await sqlState(savePeptide(adminDb, peptideArgs({ p_id: randomUUID(), p_expected_version: 1 })), "missing")).toBe("P0002");
  });

  it("the same request replays; the same key with other details is refused (AP005)", async () => {
    const args = peptideArgs({ p_vial_strengths_mg: ["5"] });
    const first = await ok(savePeptide(adminDb, args), "first");
    const again = await ok(savePeptide(adminDb, args), "again");
    expect(again).toEqual({ ...first, replayed: true });
    expect(await ok(serviceClient().from("peptides").select("id").eq("name", args.p_name), "one")).toHaveLength(1);
    expect(await sqlState(savePeptide(adminDb, { ...args, p_request_hash: hash() }), "other details")).toBe("AP005");
    // Two saves of one version at once: exactly one wins, the other is refused as stale.
    const d = await draft();
    const results = await Promise.all(
      ["A", "B"].map((v) => sqlState(savePeptide(adminDb, peptideArgs({ p_id: d.id, p_expected_version: 1, p_name: d.name, p_short_description: v })), v)),
    );
    expect(results.sort()).toEqual(["AP038", "ok"]);
    expect((await stored(d.id)).version).toBe(2);
  });
});

describe("admins only", () => {
  it("researchers and anonymous callers can't save, read the admin lists or the change log", async () => {
    const d = await draft();
    for (const [who, db] of [
      ["researcher", researcherDb],
      ["anonymous", anonClient()],
    ] as const) {
      expect(await sqlState(savePeptide(db, peptideArgs()), who)).toBe("42501");
      expect(await sqlState(db.rpc("admin_save_template", { p_request_key: randomUUID(), p_request_hash: hash(), p_id: null, p_expected_version: null, p_name: "x", p_guidance: "", p_plans: [] } as never), who)).toBe("42501");
      expect(await sqlState(db.rpc("admin_content_last_change", { p_kind: "peptide", p_id: d.id }), who)).toBe("42501");
      expect(await sqlState(db.rpc("admin_people"), who)).toBe("42501");
      expect(await sqlState(db.from("peptides").update({ short_description: "x" }).eq("id", d.id).select("id"), who)).not.toBe("ok");
    }
    // The change log (who saved) is never readable through the API, not even by an admin.
    expect(await sqlState(adminDb.from("admin_content_changes").select("request_key"), "admin log")).toBe("42501");
    // An admin can't write the tables around the functions.
    expect(await sqlState(adminDb.from("peptides").update({ published_at: new Date().toISOString() }).eq("id", d.id).select("id"), "admin direct")).not.toBe("ok");
    expect(await stored(d.id)).toMatchObject({ published_at: null });
  });
});

describe("the older writers are no longer an API", () => {
  // save_library_peptide and save_cycle_template took no expected version and
  // no request key and left no change row: a stale client could overwrite a
  // newer save and leave "changed by" naming the wrong admin.
  it("an admin (or anyone) calling either is refused, and nothing is written", async () => {
    const name = `V7 legacy call ${tag()}`;
    const plans = [{ peptide_id: (await draft({ p_information: "S.", p_publish: true })).id, phases: [{ kind: "active", offset_days: 0, length_days: 7, dose_mg: "0.4", local_time: "08:00", schedule_type: "interval", every_days: 1 }] }];
    for (const [who, db] of [
      ["admin", adminDb],
      ["researcher", researcherDb],
      ["anonymous", anonClient()],
      ["secret key", serviceClient()],
    ] as const) {
      // Untyped: the generated types no longer list the dropped function.
      const call = (fn: string, args: Record<string, unknown>) =>
        (db.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message: string } | null; status: number }>).call(db, fn, args);
      // Dropped: PostgREST has no such function.
      expect(await sqlState(call("save_library_peptide", { p_name: name, p_information: "x", p_cycling_off_guidance: "", p_supplement_guidance: "", p_available: true }), `${who} library`)).toBe("PGRST202");
      // Kept only as admin_save_template's rule engine: no API role may execute it.
      expect(await sqlState(call("save_cycle_template", { p_name: name, p_guidance: "", p_plans: plans }), `${who} template`)).toBe("42501");
    }
    expect(await ok(serviceClient().from("peptides").select("id").eq("name", name), "no entry")).toEqual([]);
    expect(await ok(serviceClient().from("cycle_templates").select("id").eq("name", name), "no template")).toEqual([]);
    // The V7 writer, which runs the same rules, still works for the admin.
    expect(await sqlState(saveTemplateAs(adminDb, { p_name: name, p_plans: plans }), "admin_save_template")).toBe("ok");
  });
});

describe("template saves (D7)", () => {
  const phase = { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "08:00", schedule_type: "interval", every_days: 2 };
  const saveTemplate = (db: Client, args: { key?: string; hash?: string; id?: string | null; version?: number | null; name: string; peptides: string[]; guidance?: string }) =>
    db
      .rpc("admin_save_template", {
        p_request_key: args.key ?? randomUUID(),
        p_request_hash: args.hash ?? hash(),
        p_id: args.id ?? null,
        p_expected_version: args.version ?? null,
        p_name: args.name,
        p_guidance: args.guidance ?? "",
        p_plans: args.peptides.map((peptide_id) => ({ peptide_id, phases: [phase] })) as Json,
      } as never)
      .single();

  it("creates, replays, edits over its version only, and keeps a peptide withdrawn since", async () => {
    const a = await createPeptide(adminDb, `V7 tpl A ${tag()}`);
    const b = await createPeptide(adminDb, `V7 tpl B ${tag()}`);
    const name = `V7 template ${tag()}`;
    const key = randomUUID();
    const h = hash();
    const created = await ok(saveTemplate(adminDb, { key, hash: h, name, peptides: [a, b] }), "create");
    expect(created).toMatchObject({ version: 1, replayed: false });
    expect(await ok(saveTemplate(adminDb, { key, hash: h, name, peptides: [a, b] }), "replay")).toEqual({ ...created, replayed: true });
    expect(await sqlState(saveTemplate(adminDb, { key, name, peptides: [a] }), "other details")).toBe("AP005");

    await setAvailable(adminDb, b, (await stored(b)).name, false);
    // Kept: the template names it, so it saves with it.
    const edited = await ok(saveTemplate(adminDb, { id: created.template_id, version: 1, name, guidance: "Edited.", peptides: [a, b] }), "edit keeps b");
    expect(edited).toMatchObject({ version: 2 });
    expect(await sqlState(saveTemplate(otherDb, { id: created.template_id, version: 1, name, peptides: [a, b] }), "stale")).toBe("AP038");
    expect(await lastChange(otherDb, "template", created.template_id)).toMatchObject({ version: 2, changedBy: admin.name });
    // Newly adding a withdrawn one, or a draft, is refused.
    const c = await createPeptide(adminDb, `V7 tpl C ${tag()}`, false);
    expect(await sqlState(saveTemplate(adminDb, { id: created.template_id, version: 2, name, peptides: [a, b, c] }), "withdrawn added")).toBe("AP007");
    const d = await draft({ p_information: "S." });
    expect(await sqlState(saveTemplate(adminDb, { name: `${name} draft`, peptides: [d.id] }), "draft added")).toBe("AP007");
    // Removing the withdrawn one and saving again is fine; it can't come back.
    expect(await ok(saveTemplate(adminDb, { id: created.template_id, version: 2, name, peptides: [a] }), "drop b")).toMatchObject({ version: 3 });
    expect(await sqlState(saveTemplate(adminDb, { id: created.template_id, version: 3, name, peptides: [a, b] }), "b back")).toBe("AP007");
    expect(await sqlState(saveTemplate(adminDb, { id: randomUUID(), version: 1, name, peptides: [a] }), "missing")).toBe("P0002");
  });
});
