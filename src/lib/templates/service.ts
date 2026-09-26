import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { Weekday } from "@/lib/schedule/engine";
import type { Database } from "@/lib/supabase/database.types";
import type { TemplatePeptide, TemplatePhase, TemplateRecord, ValidTemplate } from "./rules";

type Db = SupabaseClient<Database>;

// Admin side (A3). `db` is the admin's own session client: RLS and the SQL
// functions' is_admin() checks apply on top of the caller's role check.

/**
 * Every library entry, available or not, oldest first: names for the editor
 * and its validation, availability for "+ Add peptide" and the warnings.
 * Reads through the admin-only admin_library_peptides() (the peptides table
 * returns available entries only, to everyone).
 */
export async function listTemplatePeptides(db: Db): Promise<TemplatePeptide[]> {
  return allRows(
    (from, to) =>
      db
        .rpc("admin_library_peptides")
        .select("id, name, available, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "the library",
  ).then((rows) => rows.map(({ id, name, available }) => ({ id, name, available })));
}

/** Every template, oldest first, with its plans in order and phases by start day. */
export async function listTemplates(db: Db): Promise<TemplateRecord[]> {
  const [templates, plans, phases, usage] = await Promise.all([
    allRows(
      (from, to) =>
        db
          .from("cycle_templates")
          .select("id, name, guidance, updated_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "templates",
    ),
    allRows(
      (from, to) =>
        db
          .from("cycle_template_plans")
          .select("id, template_id, peptide_id, position")
          .order("template_id")
          .order("position")
          .range(from, to),
      "template plans",
    ),
    allRows(
      (from, to) =>
        db
          .from("cycle_template_phases")
          .select("id, plan_id, kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays")
          .order("plan_id")
          .order("offset_days")
          .range(from, to),
      "template phases",
    ),
    allRows(
      (from, to) => db.rpc("admin_cycle_template_usage").select("template_id, cycle_count").order("template_id").range(from, to),
      "template usage",
    ),
  ]);

  const phasesByPlan = new Map<string, TemplatePhase[]>();
  for (const row of phases) {
    const list = phasesByPlan.get(row.plan_id) ?? [];
    list.push(phaseOf(row));
    phasesByPlan.set(row.plan_id, list);
  }
  const plansByTemplate = new Map<string, TemplateRecord["plans"]>();
  for (const row of plans) {
    const list = plansByTemplate.get(row.template_id) ?? [];
    list.push({ peptideId: row.peptide_id, phases: phasesByPlan.get(row.id) ?? [] });
    plansByTemplate.set(row.template_id, list);
  }
  const usageById = new Map(usage.map((row) => [row.template_id, Number(row.cycle_count)]));
  return templates.map((row) => ({
    id: row.id,
    name: row.name,
    guidance: row.guidance,
    updatedAt: row.updated_at,
    plans: plansByTemplate.get(row.id) ?? [],
    cycleCount: usageById.get(row.id) ?? 0,
  }));
}

type PhaseRow = {
  kind: string;
  offset_days: number;
  length_days: number;
  dose_mg: string | null;
  local_time: string | null;
  schedule_type: string | null;
  every_days: number | null;
  weekdays: number[] | null;
};

function phaseOf(row: PhaseRow): TemplatePhase {
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

export type SaveTemplateResult =
  | { kind: "saved"; id: string }
  | { kind: "not_found" | "unavailable" | "error" };

/**
 * The peptides a stored template names (none when `templateId` is null or
 * names no template): those it may keep after they are withdrawn.
 */
export async function storedTemplatePeptides(db: Db, templateId: string | null): Promise<Set<string>> {
  if (!templateId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) return new Set();
  const { data, error } = await db.from("cycle_template_plans").select("peptide_id").eq("template_id", templateId.toLowerCase());
  if (error) throw new Error(`Could not load the template: ${error.message}`);
  return new Set((data ?? []).map((row) => row.peptide_id));
}

/** save_cycle_template's refusals: a peptide no longer offered newly added (AP007) or not in the library (AP003). */
const UNAVAILABLE = new Set(["AP007", "AP003"]);

/** The database function's plans argument (see the S8 migration). */
function plansArgument(template: ValidTemplate) {
  return template.plans.map((plan) => ({
    peptide_id: plan.peptideId,
    phases: plan.phases.map((phase) =>
      phase.kind === "break"
        ? { kind: "break", offset_days: phase.offset, length_days: phase.len }
        : {
            kind: "active",
            offset_days: phase.offset,
            length_days: phase.len,
            dose_mg: phase.doseMg,
            local_time: phase.time,
            schedule_type: phase.schedule.type,
            ...(phase.schedule.type === "interval" ? { every_days: phase.schedule.everyDays } : { weekdays: phase.schedule.days }),
          },
    ),
  }));
}

/** Creates (id null) or replaces a template through the admin-only database function. */
export async function saveTemplate(db: Db, template: ValidTemplate): Promise<SaveTemplateResult> {
  const { data, error } = await db.rpc("save_cycle_template", {
    p_name: template.name,
    p_guidance: template.guidance,
    p_plans: plansArgument(template),
    ...(template.id ? { p_id: template.id } : {}),
  });
  if (error) return { kind: UNAVAILABLE.has(error.code) ? "unavailable" : "error" };
  if (!data) return { kind: "not_found" };
  return { kind: "saved", id: data };
}
