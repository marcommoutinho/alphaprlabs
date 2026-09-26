import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTemplateForCopy } from "@/lib/cycles/service";
import type { Database } from "@/lib/supabase/database.types";
import type { Weekday } from "@/lib/schedule/engine";
import type { TemplatePhase, TemplatePlan } from "@/lib/templates/rules";
import { allRows } from "./service";

type Db = SupabaseClient<Database>;

// Research side reads for R6 (Library, peptide and template detail) and R4's
// supplied guidance. `db` is the caller's own session client. The peptides
// table returns available entries plus those the caller's OWN cycles use
// (S9's policy); browsing asks for available entries only (Marco,
// 2026-09-26: researchers never see "Not offered" peptides in the library).

/** A library entry as researchers read it. */
export type ResearchPeptide = {
  id: string;
  name: string;
  information: string;
  cyclingOff: string;
  supplement: string;
  available: boolean;
  updatedAt: string;
};

const PEPTIDE_COLUMNS = "id, name, information, cycling_off_guidance, supplement_guidance, available, updated_at";

type PeptideRow = {
  id: string;
  name: string;
  information: string;
  cycling_off_guidance: string;
  supplement_guidance: string;
  available: boolean;
  updated_at: string;
};

const peptideOf = (row: PeptideRow): ResearchPeptide => ({
  id: row.id,
  name: row.name,
  information: row.information,
  cyclingOff: row.cycling_off_guidance,
  supplement: row.supplement_guidance,
  available: row.available,
  updatedAt: row.updated_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Library browsing: available entries only, by name. */
export async function listAvailablePeptides(db: Db): Promise<ResearchPeptide[]> {
  const rows = await allRows(
    (from, to) => db.from("peptides").select(PEPTIDE_COLUMNS).eq("available", true).order("name").order("id").range(from, to),
    "the library",
  );
  return rows.map(peptideOf);
}

/** One available entry (peptide detail), or null: withdrawn entries are not browsable. */
export async function getAvailablePeptide(db: Db, id: string): Promise<ResearchPeptide | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db.from("peptides").select(PEPTIDE_COLUMNS).eq("id", id.toLowerCase()).eq("available", true).maybeSingle();
  if (error) throw new Error(`Could not load the peptide: ${error.message}`);
  return data ? peptideOf(data) : null;
}

/** The entries a cycle names, as the caller may read them (its own cycles keep withdrawn ones). */
export async function peptidesByIds(db: Db, ids: readonly string[]): Promise<ResearchPeptide[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const { data, error } = await db.from("peptides").select(PEPTIDE_COLUMNS).in("id", wanted);
  if (error) throw new Error(`Could not load the cycle's peptides: ${error.message}`);
  return (data ?? []).map(peptideOf);
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
  kind: string;
  offset_days: number;
  length_days: number;
  dose_mg: string | null;
  local_time: string | null;
  schedule_type: string | null;
  every_days: number | null;
  weekdays: number[] | null;
};

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

/**
 * Every template, by name, in one read (the shape getTemplateForCopy
 * returns). Peptide names come from `known`, the entries the caller can
 * read; a template naming one they can't (withdrawn) gets its names from
 * template_peptides(), as getTemplateForCopy does.
 */
export async function listResearchTemplates(
  db: Db,
  known: ReadonlyMap<string, { name: string; available: boolean }>,
): Promise<ResearchTemplate[]> {
  const rows = await allRows(
    (from, to) =>
      db
        .from("cycle_templates")
        .select(
          "id, name, guidance, cycle_template_plans(peptide_id, position, cycle_template_phases(kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays))",
        )
        .order("name")
        .order("id")
        .range(from, to),
    "templates",
  );
  return Promise.all(
    rows.map(async (row): Promise<ResearchTemplate> => {
      const plans: TemplatePlan[] = [...row.cycle_template_plans]
        .sort((a, b) => a.position - b.position)
        .map((plan) => ({
          peptideId: plan.peptide_id,
          phases: [...plan.cycle_template_phases].sort((a, b) => a.offset_days - b.offset_days).map(templatePhaseOf),
        }));
      const ids = [...new Set(plans.map((plan) => plan.peptideId))];
      let peptides = ids.flatMap((id) => {
        const peptide = known.get(id);
        return peptide ? [{ id, name: peptide.name, available: peptide.available }] : [];
      });
      if (peptides.length < ids.length) {
        const named = await db.rpc("template_peptides", { p_template_id: row.id });
        if (named.error) throw new Error(`Could not load the template's peptides: ${named.error.message}`);
        peptides = (named.data ?? []).map(({ id, name, available }) => ({ id, name, available }));
      }
      return { id: row.id, name: row.name, guidance: row.guidance, plans, peptides };
    }),
  );
}

/** One template, or null when there is no such template. */
export async function getResearchTemplate(db: Db, id: string): Promise<ResearchTemplate | null> {
  const template = await getTemplateForCopy(db, id);
  if (!template) return null;
  const { data, error } = await db.from("cycle_templates").select("guidance").eq("id", template.id).maybeSingle();
  if (error) throw new Error(`Could not load the template: ${error.message}`);
  if (!data) return null;
  return { ...template, guidance: data.guidance };
}
