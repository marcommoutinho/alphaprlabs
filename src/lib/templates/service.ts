import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/library/service";
import type { Weekday } from "@/lib/schedule/engine";
import type { Database } from "@/lib/supabase/database.types";
import type { TemplatePeptide, TemplatePhase, TemplateRecord, ValidTemplate } from "./rules";

type Db = SupabaseClient<Database>;

// Admin side (A10 / D7). `db` is the admin's own session client: RLS and the
// SQL functions' is_admin() checks apply on top of the caller's role check.

/**
 * Every library entry, drafts and withdrawn ones included, oldest first:
 * names for the editor and its validation; "available" (published and
 * offered) for "+ Add peptide" and the warnings. Reads through the
 * admin-only admin_library_peptides() (the peptides table returns available
 * entries only, to everyone).
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every template, drafts included (or the one with `templateId`), oldest first, with its plans in order and phases by start day. */
export async function listTemplates(db: Db, templateId: string | null = null): Promise<TemplateRecord[]> {
  const scoped = templateId?.toLowerCase() ?? null;
  const [templates, plans, usage] = await Promise.all([
    allRows((from, to) => {
      const query = db.from("cycle_templates").select("id, name, guidance, updated_at, published_at, version");
      return (scoped ? query.eq("id", scoped) : query)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    }, "templates"),
    allRows((from, to) => {
      const query = db.from("cycle_template_plans").select("id, template_id, peptide_id, position");
      return (scoped ? query.eq("template_id", scoped) : query).order("template_id").order("position").order("id").range(from, to);
    }, "template plans"),
    allRows((from, to) => {
      const query = db.rpc("admin_cycle_template_usage").select("template_id, cycle_count");
      return (scoped ? query.eq("template_id", scoped) : query).order("template_id").range(from, to);
    }, "template usage"),
  ]);
  const planIds = plans.map((plan) => plan.id);
  const phases = scoped
    ? (
        await Promise.all(
          Array.from({ length: Math.ceil(planIds.length / 100) }, (_, i) => planIds.slice(i * 100, (i + 1) * 100)).map((chunk) =>
            allRows(
              (from, to) =>
                db
                  .from("cycle_template_phases")
                  .select("id, plan_id, kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays")
                  .in("plan_id", chunk)
                  .order("plan_id")
                  .order("offset_days")
                  .range(from, to),
              "template phases",
            ),
          ),
        )
      ).flat()
    : await allRows(
        (from, to) =>
          db
            .from("cycle_template_phases")
            .select("id, plan_id, kind, offset_days, length_days, dose_mg::text, local_time, schedule_type, every_days, weekdays")
            .order("plan_id")
            .order("offset_days")
            .range(from, to),
        "template phases",
      );

  const phasesByPlan = new Map<string, TemplatePhase[]>();
  for (const row of phases) {
    const list = phasesByPlan.get(row.plan_id) ?? [];
    list.push(phaseOf(row));
    phasesByPlan.set(row.plan_id, list);
  }
  const plansByTemplate = new Map<string, TemplateRecord["plans"]>();
  for (const row of [...plans].sort((a, b) => a.position - b.position)) {
    const list = plansByTemplate.get(row.template_id) ?? [];
    list.push({ peptideId: row.peptide_id, phases: (phasesByPlan.get(row.id) ?? []).sort((a, b) => a.offset - b.offset) });
    plansByTemplate.set(row.template_id, list);
  }
  const usageById = new Map(usage.map((row) => [row.template_id, Number(row.cycle_count)]));
  return templates.map((row) => ({
    id: row.id,
    name: row.name,
    guidance: row.guidance,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    version: Number(row.version),
    plans: plansByTemplate.get(row.id) ?? [],
    cycleCount: usageById.get(row.id) ?? 0,
  }));
}

/** How many templates there are, drafts included (the Library control's "Templates · N"). */
export async function countTemplates(db: Db): Promise<number> {
  const { count, error } = await db.from("cycle_templates").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count templates: ${error.message}`);
  return count ?? 0;
}

/** One template, or null when there is none. */
export async function getTemplate(db: Db, id: string): Promise<TemplateRecord | null> {
  if (!UUID.test(id)) return null;
  const [template] = await listTemplates(db, id);
  return template ?? null;
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

/**
 * The peptides a stored template names (none when `templateId` is null or
 * names no template): those it may keep after they are withdrawn.
 */
export async function storedTemplatePeptides(db: Db, templateId: string | null): Promise<Set<string>> {
  if (!templateId || !UUID.test(templateId)) return new Set();
  const { data, error } = await db.from("cycle_template_plans").select("peptide_id").eq("template_id", templateId.toLowerCase());
  if (error) throw new Error(`Could not load the template: ${error.message}`);
  return new Set((data ?? []).map((row) => row.peptide_id));
}

/** The database functions' plans argument (see the S8 migration). */
export function plansArgument(template: Pick<ValidTemplate, "plans">) {
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

export type SaveTemplateResult =
  /** `published`: it is published after the save; `newlyPublished`: this save published it. */
  | { kind: "saved"; id: string; version: number; published: boolean; newlyPublished: boolean; replayed: boolean }
  /**
   * Refused, nothing written: `unavailable` a peptide not offered (or a
   * draft) newly added, or not in the library (AP007 / AP003); `changed`
   * saved by someone else since it was opened (AP038); `not_found` no such
   * template (P0002); `conflict` the request key was used for other details
   * (AP005); `invalid` a rule the app should have caught (22023).
   */
  | { kind: "not_authorized" | "invalid" | "unavailable" | "not_found" | "changed" | "conflict" }
  /** No answer: it may have committed. Retry with the same request key. */
  | { kind: "unsure" };

/**
 * Creates (id null) or replaces a template, only over the version it was
 * opened at; idempotent by request key. `publish` is the state it is left in:
 * published (researchers see it) or a draft (hidden from them, also when it
 * was published before).
 */
export async function saveTemplate(
  db: Db,
  input: { requestKey: string; requestHash: string; version: number | null; publish: boolean; template: ValidTemplate },
): Promise<SaveTemplateResult> {
  const { template } = input;
  const { data, error } = await db
    .rpc("admin_save_template", {
      p_request_key: input.requestKey,
      p_request_hash: input.requestHash,
      // The generated types can't express a nullable argument.
      p_id: template.id as string,
      p_expected_version: input.version as number,
      p_name: template.name,
      p_guidance: template.guidance,
      p_plans: plansArgument(template),
      p_published: input.publish,
    })
    .single();
  if (error || !data) {
    switch (error?.code) {
      case "42501":
        return { kind: "not_authorized" };
      case "22023":
        return { kind: "invalid" };
      case "AP003":
      case "AP007":
        return { kind: "unavailable" };
      case "P0002":
        return { kind: "not_found" };
      case "AP005":
        return { kind: "conflict" };
      case "AP038":
        return { kind: "changed" };
      default:
        return { kind: "unsure" };
    }
  }
  return {
    kind: "saved",
    id: data.template_id,
    version: Number(data.version),
    published: data.published,
    newlyPublished: data.newly_published,
    replayed: data.replayed,
  };
}
