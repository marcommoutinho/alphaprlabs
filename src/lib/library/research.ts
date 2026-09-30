import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Weekday } from "@/lib/schedule/engine";
import type { Database } from "@/lib/supabase/database.types";
import type { TemplatePhase, TemplatePlan } from "@/lib/templates/rules";

type Db = SupabaseClient<Database>;

// Research side reads for R6 (Library, peptide and template detail) and R4's
// supplied guidance. `db` is the caller's own session client. The peptides
// table returns available entries plus those the caller's OWN cycles use
// (S9's policy); browsing asks for available entries only (Marco,
// 2026-09-26: researchers never see "Not offered" peptides in the library).
//
// Every read is complete: rows are read a page at a time by id (keyset), so
// the API's 1,000-row cap never cuts a list short, and id lists are sent in
// bounded chunks. Templates are read as flat rows (templates, plans, phases)
// joined here, never as embedded rows, which the cap would truncate silently.

/** Rows per request; the API caps a response at 1,000 rows. */
const PAGE = 1000;
/** Ids per `in (...)` filter. */
const CHUNK = 100;
/** template_peptides() calls in flight at once. */
const PARALLEL = 10;

/** Page and chunk sizes; tests lower them to prove paging. */
export type ReadSizes = { pageSize?: number; chunkSize?: number };

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Every row, `pageSize` at a time in id order: `page(after, limit)` reads rows with id > after. */
async function keysetRows<Row extends { id: string }>(
  page: (after: string | null, limit: number) => Page<Row>,
  what: string,
  pageSize = PAGE,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let after: string | null = null; ; ) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
    after = got[got.length - 1].id;
  }
}

const chunks = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** A library entry as researchers read it. */
export type ResearchPeptide = {
  id: string;
  name: string;
  /** A9's short description (V7); "" when the entry has none. */
  shortDescription: string;
  information: string;
  cyclingOff: string;
  supplement: string;
  available: boolean;
  updatedAt: string;
};

const PEPTIDE_COLUMNS = "id, name, short_description, information, cycling_off_guidance, supplement_guidance, available, updated_at";

type PeptideRow = {
  id: string;
  name: string;
  short_description: string;
  information: string;
  cycling_off_guidance: string;
  supplement_guidance: string;
  available: boolean;
  updated_at: string;
};

const peptideOf = (row: PeptideRow): ResearchPeptide => ({
  id: row.id,
  name: row.name,
  shortDescription: row.short_description,
  information: row.information,
  cyclingOff: row.cycling_off_guidance,
  supplement: row.supplement_guidance,
  available: row.available,
  updatedAt: row.updated_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Library browsing: available entries only, by name. */
export async function listAvailablePeptides(db: Db, sizes: ReadSizes = {}): Promise<ResearchPeptide[]> {
  const rows = await keysetRows(
    (after, limit) => {
      const query = db.from("peptides").select(PEPTIDE_COLUMNS).eq("available", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    },
    "the library",
    sizes.pageSize,
  );
  return rows.map(peptideOf).sort(byName);
}

/**
 * R12's entry for this researcher, or null. An available entry for anyone;
 * a withdrawn one only when one of `ownerId`'s own cycles uses it (Marco,
 * 2026-09-28: it stays openable from the owner's cycle while hidden from
 * browsing and new cycles). That rule is checked here against the caller's
 * own cycle plans, not left to the table's policy, which also lets a
 * withdrawn entry through for a saved mixture or a personal vial.
 */
export async function getPeptideForDetail(db: Db, ownerId: string, id: string): Promise<ResearchPeptide | null> {
  if (!UUID.test(id)) return null;
  const peptideId = id.toLowerCase();
  const { data, error } = await db.from("peptides").select(PEPTIDE_COLUMNS).eq("id", peptideId).maybeSingle();
  if (error) throw new Error(`Could not load the peptide: ${error.message}`);
  if (!data) return null;
  if (data.available) return peptideOf(data);
  const { data: plans, error: planError } = await db
    .from("cycle_plans")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("peptide_id", peptideId)
    .limit(1);
  if (planError) throw new Error(`Could not load the peptide's cycles: ${planError.message}`);
  return (plans ?? []).length > 0 ? peptideOf(data) : null;
}

/**
 * The entries with these ids, as the caller may read them (their own cycles
 * keep withdrawn ones): the ids in chunks, each chunk paged.
 */
export async function peptidesByIds(db: Db, ids: readonly string[], sizes: ReadSizes = {}): Promise<ResearchPeptide[]> {
  const wanted = [...new Set(ids)];
  const parts = await Promise.all(
    chunks(wanted, sizes.chunkSize ?? CHUNK).map((chunk) =>
      keysetRows(
        (after, limit) => {
          const query = db.from("peptides").select(PEPTIDE_COLUMNS).in("id", chunk);
          return (after ? query.gt("id", after) : query).order("id").limit(limit);
        },
        "the cycle's peptides",
        sizes.pageSize,
      ),
    ),
  );
  return parts.flat().map(peptideOf);
}

/** A template as researchers read it, with the names of every peptide it names (withdrawn ones too). */
export type ResearchTemplate = {
  id: string;
  name: string;
  guidance: string;
  plans: TemplatePlan[];
  peptides: { id: string; name: string; available: boolean }[];
};

type TemplatePhaseRow = {
  id: string;
  plan_id: string;
  kind: string;
  offset_days: number;
  length_days: number;
  dose_mg: string | null;
  local_time: string | null;
  schedule_type: string | null;
  every_days: number | null;
  weekdays: number[] | null;
};

const PHASE_COLUMNS = "id, plan_id, kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays";

/** A stored template phase as TemplatePhase (the shape getTemplateForCopy returns). */
function templatePhaseOf(row: TemplatePhaseRow): TemplatePhase {
  const days = { offset: row.offset_days, len: row.length_days };
  if (row.kind === "break") return { kind: "break", ...days };
  return {
    kind: "active",
    ...days,
    doseMg: row.dose_mg ?? "",
    time: row.local_time ?? "",
    schedule:
      row.schedule_type === "weekdays"
        ? { type: "weekdays", days: (row.weekdays ?? []) as Weekday[] }
        : { type: "interval", everyDays: row.every_days ?? 0 },
  };
}

type Named = { id: string; name: string; available: boolean };

/**
 * Names for every peptide the templates name. `known` covers what the
 * caller can read; each peptide it lacks (withdrawn) is resolved through
 * template_peptides() at most once: one call per template chosen to cover
 * peptides not yet resolved, so the calls are bounded by the number of such
 * peptides, never by the number of templates.
 */
async function templateNames(
  db: Db,
  templates: readonly { id: string; plans: TemplatePlan[] }[],
  known: ReadonlyMap<string, Omit<Named, "id">>,
): Promise<Map<string, Named>> {
  const names = new Map<string, Named>();
  for (const [id, peptide] of known) names.set(id, { id, name: peptide.name, available: peptide.available });
  const picks: string[] = [];
  const covered = new Set<string>();
  for (const template of templates) {
    const missing = template.plans.map((plan) => plan.peptideId).filter((id) => !names.has(id) && !covered.has(id));
    if (missing.length === 0) continue;
    picks.push(template.id);
    missing.forEach((id) => covered.add(id));
  }
  for (const batch of chunks(picks, PARALLEL)) {
    const results = await Promise.all(batch.map((id) => db.rpc("template_peptides", { p_template_id: id })));
    for (const { data, error } of results) {
      if (error) throw new Error(`Could not load the template's peptides: ${error.message}`);
      for (const { id, name, available } of data ?? []) names.set(id, { id, name, available });
    }
  }
  return names;
}

/** Published templates (all, or one), their plans and phases read flat and paged, joined here. */
async function readTemplates(
  db: Db,
  templateId: string | null,
  known: ReadonlyMap<string, Omit<Named, "id">>,
  sizes: ReadSizes,
): Promise<ResearchTemplate[]> {
  const templates = await keysetRows(
    (after, limit) => {
      // Published only: the database shows researchers nothing else, and an admin on the research side sees what they see.
      const query = db.from("cycle_templates").select("id, name, guidance").not("published_at", "is", null);
      const scoped = templateId ? query.eq("id", templateId) : query;
      return (after ? scoped.gt("id", after) : scoped).order("id").limit(limit);
    },
    "templates",
    sizes.pageSize,
  );
  if (templates.length === 0) return [];
  const plans = await keysetRows(
    (after, limit) => {
      const query = db.from("cycle_template_plans").select("id, template_id, peptide_id, position");
      const scoped = templateId ? query.eq("template_id", templateId) : query;
      return (after ? scoped.gt("id", after) : scoped).order("id").limit(limit);
    },
    "template plans",
    sizes.pageSize,
  );
  const phaseRows = (planIds: string[] | null) =>
    keysetRows<TemplatePhaseRow>(
      (after, limit) => {
        const query = db.from("cycle_template_phases").select(PHASE_COLUMNS);
        const scoped = planIds ? query.in("plan_id", planIds) : query;
        return (after ? scoped.gt("id", after) : scoped).order("id").limit(limit) as unknown as Page<TemplatePhaseRow>;
      },
      "template phases",
      sizes.pageSize,
    );
  const phases = templateId
    ? (await Promise.all(chunks(plans.map((plan) => plan.id), sizes.chunkSize ?? CHUNK).map(phaseRows))).flat()
    : await phaseRows(null);

  const phasesOf = new Map<string, TemplatePhaseRow[]>();
  for (const row of phases) phasesOf.set(row.plan_id, [...(phasesOf.get(row.plan_id) ?? []), row]);
  const plansOf = new Map<string, typeof plans>();
  for (const row of plans) plansOf.set(row.template_id, [...(plansOf.get(row.template_id) ?? []), row]);

  const shaped = templates.sort(byName).map((row) => ({
    id: row.id,
    name: row.name,
    guidance: row.guidance,
    plans: [...(plansOf.get(row.id) ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(
        (plan): TemplatePlan => ({
          peptideId: plan.peptide_id,
          phases: [...(phasesOf.get(plan.id) ?? [])].sort((a, b) => a.offset_days - b.offset_days).map(templatePhaseOf),
        }),
      ),
  }));
  const names = await templateNames(db, shaped, known);
  return shaped.map((template) => ({
    ...template,
    peptides: [...new Set(template.plans.map((plan) => plan.peptideId))].flatMap((id) => {
      const named = names.get(id);
      return named ? [named] : [];
    }),
  }));
}

/**
 * Every published template, by name, as "Use as starting point" copies it.
 * Names come from `known` (the entries the caller can read) and, for
 * withdrawn ones, template_peptides() (see templateNames).
 */
export function listResearchTemplates(
  db: Db,
  known: ReadonlyMap<string, Omit<Named, "id">>,
  sizes: ReadSizes = {},
): Promise<ResearchTemplate[]> {
  return readTemplates(db, null, known, sizes);
}

/** One published template, or null when there is no such template (a draft reads as none). */
export async function getResearchTemplate(db: Db, id: string, sizes: ReadSizes = {}): Promise<ResearchTemplate | null> {
  if (!UUID.test(id)) return null;
  const [template] = await readTemplates(db, id.toLowerCase(), new Map(), sizes);
  return template ?? null;
}
