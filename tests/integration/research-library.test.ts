// S10 R6 and R4 reads against the real local Supabase: every read is
// complete (keyset pages, chunked id lists; proven with lowered sizes) and
// withdrawn peptides named by templates cost a bounded number of
// template_peptides() calls, however many templates name them. The local
// database is shared by every run, so assertions look at this run's rows
// (unique names) and bound counts by what the database holds.
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { listCyclePeptides } from "@/lib/cycles/service";
import { getResearchTemplate, listAvailablePeptides, listResearchTemplates, peptidesByIds } from "@/lib/library/research";
import type { Database } from "@/lib/supabase/database.types";
import { type Client, createPeptide, setAvailable, tag } from "../support/cycles";
import { ensureAccount, localSupabase, ok, serviceClient, signedInClient, TEST_PASSWORD, uniqueEmail } from "../support/local-supabase";

const admin = { email: uniqueEmail("s10-lib-admin"), name: "S10 Library Admin" };
const reader = { email: uniqueEmail("s10-lib-reader"), name: "S10 Library Reader" };
const t = tag();
const names = { a: `Read A ${t}`, w1: `Read W1 ${t}`, w2: `Read W2 ${t}` };
const ids = { a: "", w1: "", w2: "" };
const templateIds: string[] = [];
let many = "";

/** A signed-in client that counts its requests by path. */
async function countingClient(email: string) {
  const calls: string[] = [];
  const { url, publishableKey } = localSupabase();
  const client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        calls.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
        return fetch(input, init);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  calls.length = 0;
  return { client, calls };
}

const active = (offset: number, len: number, dose = "0.4") => ({
  kind: "active",
  offset_days: offset,
  length_days: len,
  dose_mg: dose,
  local_time: "20:00",
  schedule_type: "interval",
  every_days: 1,
});

async function createTemplate(adminDb: Client, name: string, plans: unknown[]) {
  const id = await ok(adminDb.rpc("save_cycle_template", { p_name: name, p_guidance: `Guidance ${name}`, p_plans: plans as never }), name);
  if (!id) throw new Error(`No id for ${name}`);
  return id;
}

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...reader, role: "researcher" });
  const adminDb = await signedInClient(admin.email);
  ids.a = await createPeptide(adminDb, names.a);
  ids.w1 = await createPeptide(adminDb, names.w1);
  ids.w2 = await createPeptide(adminDb, names.w2);
  // Six templates: three name W1, three name W2 (each with A too).
  for (let i = 0; i < 6; i++) {
    const withdrawn = i < 3 ? ids.w1 : ids.w2;
    templateIds.push(
      await createTemplate(adminDb, `Read template ${i} ${t}`, [
        { peptide_id: ids.a, phases: [active(0, 10)] },
        { peptide_id: withdrawn, phases: [active(0, 5, "1")] },
      ]),
    );
  }
  // One template with many phases: 12 consecutive two-day phases.
  many = await createTemplate(adminDb, `Read many ${t}`, [
    { peptide_id: ids.a, phases: Array.from({ length: 12 }, (_, i) => active(i * 2, 2, String(i + 1))) },
  ]);
  await setAvailable(adminDb, ids.w1, names.w1, false);
  await setAvailable(adminDb, ids.w2, names.w2, false);
});

const known = async (db: Client) => new Map((await listCyclePeptides(db)).map((p) => [p.id, p]));

describe("R6 template reads", () => {
  it("resolves each withdrawn peptide once, however many templates name it", async () => {
    const { client, calls } = await countingClient(reader.email);
    const readable = await known(client);
    calls.length = 0;
    const templates = await listResearchTemplates(client, readable);
    const rpcCalls = calls.filter((path) => path.endsWith("/rpc/template_peptides")).length;

    const mine = templates.filter((template) => templateIds.includes(template.id));
    expect(mine.map((template) => template.peptides.map((p) => [p.name, p.available]))).toEqual([
      ...Array(3).fill([
        [names.a, true],
        [names.w1, false],
      ]),
      ...Array(3).fill([
        [names.a, true],
        [names.w2, false],
      ]),
    ]);

    // Bounded by the withdrawn peptides templates name (all runs' rows), not by templates.
    const plans = await ok(serviceClient().from("cycle_template_plans").select("template_id, peptide_id, peptides!inner(available)").eq("peptides.available", false), "withdrawn in templates");
    const withdrawnPeptides = new Set(plans.map((row) => row.peptide_id)).size;
    const templatesNamingThem = new Set(plans.map((row) => row.template_id)).size;
    expect(rpcCalls).toBeGreaterThan(0);
    expect(rpcCalls).toBeLessThanOrEqual(withdrawnPeptides);
    // This run's six templates share two withdrawn peptides, so there are always fewer calls than templates.
    expect(rpcCalls).toBeLessThan(templatesNamingThem);
  });

  it("reads plans and phases completely a page at a time", async () => {
    const db = await signedInClient(reader.email);
    const readable = await known(db);
    const full = await listResearchTemplates(db, readable);
    const paged = await listResearchTemplates(db, readable, { pageSize: 3 });
    const pick = (list: typeof full) => list.filter((template) => template.id === many || templateIds.includes(template.id));
    expect(pick(paged)).toEqual(pick(full));
    const [manyTemplate] = pick(paged).filter((template) => template.id === many);
    expect(manyTemplate.plans[0].phases.map((phase) => (phase.kind === "active" ? phase.doseMg : ""))).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );

    // One template: the same, paged with lowered page and chunk sizes.
    const one = await getResearchTemplate(db, many, { pageSize: 2, chunkSize: 1 });
    expect(one).toEqual(manyTemplate);
    expect(await getResearchTemplate(db, templateIds[0])).toMatchObject({
      guidance: `Guidance Read template 0 ${t}`,
      peptides: expect.arrayContaining([expect.objectContaining({ name: names.w1, available: false })]),
    });
    expect(await getResearchTemplate(db, "not-a-uuid")).toBeNull();
    expect(await getResearchTemplate(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("peptide reads", () => {
  it("reads ids in chunks, each paged, and only what the caller may read", async () => {
    const adminDb = await signedInClient(admin.email);
    const extra = [await createPeptide(adminDb, `Read B ${t}`), await createPeptide(adminDb, `Read C ${t}`), await createPeptide(adminDb, `Read D ${t}`)];
    const db = await signedInClient(reader.email);
    const wanted = [ids.a, ...extra, ids.w1, ids.a];
    const all = await peptidesByIds(db, wanted);
    const small = await peptidesByIds(db, wanted, { chunkSize: 2, pageSize: 1 });
    const sorted = (list: { id: string }[]) => list.map((p) => p.id).sort();
    // W1 is withdrawn and not in the reader's cycles: not readable.
    expect(sorted(small)).toEqual([ids.a, ...extra].sort());
    expect(sorted(all)).toEqual(sorted(small));
    expect(await peptidesByIds(db, [])).toEqual([]);

    // Other files add peptides concurrently: compare this run's entries, across many small pages.
    const available = await listAvailablePeptides(db, { pageSize: 7 });
    expect(new Set(available.map((p) => p.id)).size).toBe(available.length);
    expect(available.filter((p) => p.name.endsWith(t)).map((p) => p.name)).toEqual([names.a, `Read B ${t}`, `Read C ${t}`, `Read D ${t}`]);
  });
});
