// Template drafts (20261001100000_template_drafts.sql; Marco, 2026-09-30,
// "Yes to draft stage") against the real local Supabase, through PostgREST as
// each signed-in person, as the app calls it: a new template is a draft that
// researchers can't list, read, count or copy through any path (the tables,
// template_peptides(), save_cycle() and save_cycle_with_mixtures(), and the
// app's readers); publishing shows it; moving it back to draft hides it again
// and leaves cycles already made from it untouched; the change log records
// published / newly_published; request keys replay (AP005 for other
// details) and a save over an older version is refused (AP038), the state
// included; an older app that sends no state keeps it.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getCycle, getTemplateForCopy, listCyclePeptides } from "@/lib/cycles/service";
import { getResearchTemplate, listResearchTemplates } from "@/lib/library/research";
import type { Json } from "@/lib/supabase/database.types";
import { getTemplate, listTemplates } from "@/lib/templates/service";
import { createCycle, createPeptide, cycleArgs, day, interval, plan, saveCycle, tag, type Client } from "../support/cycles";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const admin = { email: uniqueEmail("tpl-drafts-admin"), name: "Drafts Admin" };
const researcher = { email: uniqueEmail("tpl-drafts-researcher"), name: "Drafts Researcher" };
const unacknowledged = { email: uniqueEmail("tpl-drafts-new"), name: "Drafts Unacknowledged" };

let adminDb: Client;
let researcherDb: Client;
let peptideId: string;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...unacknowledged, role: "researcher", acknowledged: false });
  [adminDb, researcherDb] = await Promise.all([signedInClient(admin.email), signedInClient(researcher.email)]);
  peptideId = await createPeptide(adminDb, `Drafts peptide ${tag()}`);
});

const hash = () => randomBytes(32).toString("hex");
const phases = [{ kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "08:00", schedule_type: "interval", every_days: 2 }];

type SaveArgs = { key?: string; hash?: string; id?: string | null; version?: number | null; name: string; guidance?: string; published?: boolean | null };
type Saved = { template_id: string; version: number; published: boolean; newly_published: boolean; replayed: boolean };

/** admin_save_template as the app calls it; `published` undefined sends no state (an older app). */
const save = (db: Client, args: SaveArgs) =>
  db
    .rpc("admin_save_template", {
      p_request_key: args.key ?? randomUUID(),
      p_request_hash: args.hash ?? hash(),
      p_id: args.id ?? null,
      p_expected_version: args.version ?? null,
      p_name: args.name,
      p_guidance: args.guidance ?? "",
      p_plans: [{ peptide_id: peptideId, phases }] as Json,
      ...(args.published === undefined ? {} : { p_published: args.published }),
    } as never)
    .single<Saved>();

const row = async (id: string) =>
  (await ok(serviceClient().from("cycle_templates").select("version, published_at, updated_at").eq("id", id), "template"))[0];
const changeRow = async (key: string) =>
  (await ok(serviceClient().from("admin_content_changes").select("kind, target_id, version, published, newly_published, changed").eq("request_key", key), "change"))[0];

/** Everything a researcher (or anyone) could learn about template `id` through the API. */
async function seenBy(db: Client, id: string) {
  const plans = await ok(serviceClient().from("cycle_template_plans").select("id").eq("template_id", id), "plan ids");
  const planIds = plans.map((p) => p.id);
  const { count } = await db.from("cycle_templates").select("id", { count: "exact", head: true }).eq("id", id);
  return {
    templates: (await ok(db.from("cycle_templates").select("id").eq("id", id), "templates")).length,
    counted: count ?? 0,
    plans: (await ok(db.from("cycle_template_plans").select("id").eq("template_id", id), "plans")).length,
    phases: (await ok(db.from("cycle_template_phases").select("id").in("plan_id", planIds), "phases")).length,
    peptides: (await ok(db.rpc("template_peptides", { p_template_id: id }), "template_peptides")).length,
    page: (await getResearchTemplate(db, id)) !== null,
    listed: (await listResearchTemplates(db, new Map((await listCyclePeptides(db)).map((p) => [p.id, p])))).some((template) => template.id === id),
    copy: (await getTemplateForCopy(db, id)) !== null,
  };
}
const hidden = { templates: 0, counted: 0, plans: 0, phases: 0, peptides: 0, page: false, listed: false, copy: false };
const visible = { templates: 1, counted: 1, plans: 1, phases: 1, peptides: 1, page: true, listed: true, copy: true };

const copyArgs = (templateId: string) => ({ templateId, plans: [plan(peptideId, [interval(day(1), day(28))])] });
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
const copyWithMixes = (templateId: string) =>
  researcherDb.rpc("save_cycle_with_mixtures", {
    ...cycleArgs(copyArgs(templateId)),
    p_request_key: randomUUID(),
    p_request_hash: hashOf(randomUUID()),
    p_mixtures: [] as never,
  });

describe("a draft is hidden from researchers everywhere", () => {
  it("a new template is a draft: researchers can't list, read, count or copy it, even calling the database directly", async () => {
    const name = `Draft ${tag()}`;
    const key = randomUUID();
    const created = await ok(save(adminDb, { key, name, published: false }), "create draft");
    expect(created).toMatchObject({ version: 1, published: false, newly_published: false, replayed: false });
    const id = created.template_id;
    expect((await row(id)).published_at).toBeNull();
    expect(await changeRow(key)).toMatchObject({ kind: "template", target_id: id, version: 1, published: false, newly_published: false, changed: true });

    expect(await seenBy(researcherDb, id)).toEqual(hidden);
    // Copying it: save_cycle and the builder's save_cycle_with_mixtures refuse it as an unknown template.
    expect(await sqlState(saveCycle(researcherDb, copyArgs(id)), "save_cycle from a draft")).toBe("AP008");
    expect(await sqlState(copyWithMixes(id), "save_cycle_with_mixtures from a draft")).toBe("AP008");
    expect(await ok(serviceClient().from("cycles").select("id").eq("template_id", id), "no cycle")).toEqual([]);
    // Nobody else learns more: an unacknowledged researcher or an anonymous caller.
    expect(await ok((await signedInClient(unacknowledged.email)).from("cycle_templates").select("id").eq("id", id), "unacknowledged")).toEqual([]);
    expect(await sqlState(anonClient().from("cycle_templates").select("id").eq("id", id), "anon")).toBe("42501");
    // No count researchers can ask for names templates: the admin counts are admin-only.
    for (const fn of ["admin_cycle_template_usage", "library_reference_counts", "admin_library_entries"] as const) {
      expect(await sqlState(researcherDb.rpc(fn), fn)).toBe("42501");
    }
  });

  it("admins see drafts in the back office, and their counts include them; on the research side they see what researchers see", async () => {
    const name = `Admin draft ${tag()}`;
    const { template_id: id } = await ok(save(adminDb, { name, published: false }), "create draft");
    expect(await getTemplate(adminDb, id)).toMatchObject({ id, name, publishedAt: null, version: 1, cycleCount: 0 });
    expect((await listTemplates(adminDb)).find((template) => template.id === id)).toMatchObject({ publishedAt: null });
    expect(await ok(adminDb.rpc("admin_cycle_template_usage").eq("template_id", id), "usage")).toEqual([{ template_id: id, cycle_count: 0 }]);
    const [counts] = await ok(adminDb.rpc("library_reference_counts").eq("peptide_id", peptideId), "reference counts");
    const [entry] = await ok(adminDb.rpc("admin_library_entries").eq("id", peptideId), "entry");
    expect(Number(entry.template_count)).toBe(Number(counts.template_count));
    expect(Number(counts.template_count)).toBeGreaterThanOrEqual(1);
    // The research screens ask for published templates, so an admin there sees none of it; nor can an admin copy it.
    expect(await getResearchTemplate(adminDb, id)).toBeNull();
    expect(await getTemplateForCopy(adminDb, id)).toBeNull();
    expect((await listResearchTemplates(adminDb, new Map((await listCyclePeptides(adminDb)).map((p) => [p.id, p])))).some((template) => template.id === id)).toBe(false);
    expect(await ok(adminDb.rpc("template_peptides", { p_template_id: id }), "template_peptides")).toEqual([]);
    expect(await sqlState(saveCycle(adminDb, copyArgs(id)), "admin copy")).toBe("AP008");
  });
});

describe("publish, move back to draft", () => {
  it("publishing shows it; moving it back to draft hides it again and leaves cycles made from it untouched", async () => {
    const name = `Lifecycle ${tag()}`;
    const { template_id: id } = await ok(save(adminDb, { name, guidance: "Take it slow.", published: false }), "create draft");
    const drafted = await row(id);

    // Publish, content unchanged: one version, recorded as newly published; the content's date stays.
    const publishKey = randomUUID();
    expect(await ok(save(adminDb, { key: publishKey, id, version: 1, name, guidance: "Take it slow.", published: true }), "publish")).toMatchObject({
      template_id: id,
      version: 2,
      published: true,
      newly_published: true,
      replayed: false,
    });
    const published = await row(id);
    expect(published.published_at).not.toBeNull();
    expect(published.updated_at).toBe(drafted.updated_at);
    expect(await changeRow(publishKey)).toMatchObject({ version: 2, published: true, newly_published: true, changed: true });
    expect(await seenBy(researcherDb, id)).toEqual(visible);

    // Saved again as published: nothing changed, still published, not newly.
    const againKey = randomUUID();
    expect(await ok(save(adminDb, { key: againKey, id, version: 2, name, guidance: "Take it slow.", published: true }), "save and publish")).toMatchObject({
      version: 2,
      published: true,
      newly_published: false,
    });
    expect(await changeRow(againKey)).toMatchObject({ version: 2, published: true, newly_published: false, changed: false });
    expect((await row(id)).published_at).toBe(published.published_at);

    // A researcher copies it.
    const cycleId = await createCycle(researcherDb, copyArgs(id));
    const before = await getCycle(researcherDb, cycleId);
    expect(before).toMatchObject({ templateId: id, templateName: name, templateGuidance: "Take it slow." });

    // Moved back to draft, with an edit: hidden again; the copy is untouched.
    const draftKey = randomUUID();
    expect(await ok(save(adminDb, { key: draftKey, id, version: 2, name: `${name} v2`, guidance: "Changed.", published: false }), "move to draft")).toMatchObject({
      version: 3,
      published: false,
      newly_published: false,
    });
    expect((await row(id)).published_at).toBeNull();
    expect(await changeRow(draftKey)).toMatchObject({ version: 3, published: false, newly_published: false, changed: true });
    expect(await seenBy(researcherDb, id)).toEqual(hidden);
    expect(await getCycle(researcherDb, cycleId)).toEqual(before);
    expect(await sqlState(saveCycle(researcherDb, copyArgs(id)), "copy after drafting")).toBe("AP008");
    // The admin still counts the cycle made from it.
    expect(await ok(adminDb.rpc("admin_cycle_template_usage").eq("template_id", id), "usage")).toEqual([{ template_id: id, cycle_count: 1 }]);

    // Published again: visible again, newly published again.
    expect(await ok(save(adminDb, { id, version: 3, name: `${name} v2`, guidance: "Changed.", published: true }), "publish again")).toMatchObject({
      version: 4,
      published: true,
      newly_published: true,
    });
    expect(await seenBy(researcherDb, id)).toEqual(visible);
    expect(await getCycle(researcherDb, cycleId)).toEqual(before);
  });

  it("a template created published is newly published; an older app that sends no state keeps it (a new one is a draft)", async () => {
    const key = randomUUID();
    const created = await ok(save(adminDb, { key, name: `Published at once ${tag()}`, published: true }), "create published");
    expect(created).toMatchObject({ version: 1, published: true, newly_published: true });
    expect(await changeRow(key)).toMatchObject({ published: true, newly_published: true });
    expect(await seenBy(researcherDb, created.template_id)).toEqual(visible);
    // No p_published: the state is kept.
    expect(await ok(save(adminDb, { id: created.template_id, version: 1, name: `Kept ${tag()}` }), "no state")).toMatchObject({
      version: 2,
      published: true,
      newly_published: false,
    });
    const fresh = await ok(save(adminDb, { name: `Stateless new ${tag()}` }), "new without state");
    expect(fresh).toMatchObject({ published: false, newly_published: false });
    expect(await seenBy(researcherDb, fresh.template_id)).toEqual(hidden);
  });
});

describe("request keys and versions", () => {
  it("replays a publish with its first answer, even after it was drafted since; another hash is refused (AP005)", async () => {
    const name = `Replay ${tag()}`;
    const { template_id: id } = await ok(save(adminDb, { name, published: false }), "create draft");
    const key = randomUUID();
    const h = hash();
    const first = await ok(save(adminDb, { key, hash: h, id, version: 1, name, published: true }), "publish");
    expect(first).toMatchObject({ version: 2, published: true, newly_published: true, replayed: false });
    await ok(save(adminDb, { id, version: 2, name, published: false }), "drafted since");
    expect(await ok(save(adminDb, { key, hash: h, id, version: 1, name, published: true }), "replay")).toEqual({ ...first, replayed: true });
    expect((await row(id)).published_at).toBeNull();
    expect(await sqlState(save(adminDb, { key, id, version: 1, name, published: true }), "other details")).toBe("AP005");
  });

  it("publishing or drafting moves the version: an editor opened before is refused (AP038) and writes nothing", async () => {
    const name = `Versions ${tag()}`;
    const { template_id: id } = await ok(save(adminDb, { name, published: false }), "create draft");
    await ok(save(adminDb, { id, version: 1, name, published: true }), "publish");
    // Still at version 1: its Save draft would silently hide the template.
    expect(await sqlState(save(adminDb, { id, version: 1, name, published: false }), "stale draft")).toBe("AP038");
    expect((await row(id)).published_at).not.toBeNull();
    await ok(save(adminDb, { id, version: 2, name, published: false }), "move to draft");
    expect(await sqlState(save(adminDb, { id, version: 2, name, published: true }), "stale publish")).toBe("AP038");
    expect(await row(id)).toMatchObject({ version: 3, published_at: null });
    // Researchers still can't publish or draft anything.
    expect(await sqlState(save(researcherDb, { id, version: 3, name, published: true }), "researcher")).toBe("42501");
    expect(await sqlState(researcherDb.from("cycle_templates").update({ published_at: new Date().toISOString() }).eq("id", id), "direct")).toBe("42501");
    expect((await row(id)).published_at).toBeNull();
  });
});
