"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import {
  CYCLE_CHANGED,
  CYCLE_GONE,
  CYCLE_SAVED,
  editIssueMessage,
  FUTURE_PLAN_UPDATED,
  PAST_REACHED,
  TEMPLATE_BLOCKED,
} from "@/lib/cycles/display";
import { type RevisedPlan, reviseCycle } from "@/lib/cycles/revise";
import { INVALID_CYCLE, validateCycle } from "@/lib/cycles/rules";
import { getCycle, listCyclePeptides, saveCycle } from "@/lib/cycles/service";
import { createClient } from "@/lib/supabase/server";

export type CycleActionResult = {
  /** R3's "Fix these before saving" list, in order. */
  errors?: string[];
  toast?: string;
  tone?: ToastTone;
  /** Saved: the builder leaves for the cycles list. */
  saved?: boolean;
  cycleId?: string;
};

const failed = (): CycleActionResult => ({ toast: SAVE_FAILED_MESSAGE, tone: "error" });

/**
 * R3 Save: create a cycle (custom, or copied from a template) or save an edit
 * as the next revision, for the signed-in, acknowledged researcher (or admin
 * using the research side) and only for their own cycles. Validates with the
 * builder's rules and the S7 engine; an edit changes future doses only
 * (reviseCycle). save_cycle() re-checks ownership and every structural rule.
 */
export async function saveCycleAction(input: unknown): Promise<CycleActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: "/app/cycles" }));

  const db = await createClient();
  let peptides;
  try {
    peptides = await listCyclePeptides(db);
  } catch {
    return failed();
  }
  const valid = validateCycle(input, peptides);
  if (!valid.ok) return { errors: valid.errors };
  const cycle = valid.value;
  const nameOf = (id: string) => peptides.find((peptide) => peptide.id === id)?.name ?? "Unknown peptide";

  let revised: RevisedPlan[] | undefined;
  if (cycle.cycleId) {
    let current;
    try {
      current = await getCycle(db, cycle.cycleId);
    } catch {
      return failed();
    }
    // Only the owner edits; a support grant reads but never writes.
    if (!current || current.ownerId !== person.id) return { toast: CYCLE_GONE, tone: "error" };
    if (current.currentRevision !== cycle.revision) return { errors: [CYCLE_CHANGED] };
    // Recorded doses (S12) will be passed here so none is ever replaced.
    const revision = reviseCycle(current.revisions[current.revisions.length - 1], cycle, new Date());
    if (!revision.ok) return { errors: revision.issues.map((issue) => editIssueMessage(issue, nameOf)) };
    revised = revision.plans;
  }

  const result = await saveCycle(db, cycle, revised);
  switch (result.kind) {
    case "saved":
      revalidatePath("/app/cycles");
      return { saved: true, cycleId: result.id, toast: cycle.cycleId ? FUTURE_PLAN_UPDATED : CYCLE_SAVED, tone: "info" };
    case "unavailable": {
      // Withdrawn after the check above: say which, from the library as it is now.
      const again = validateCycle(input, await listCyclePeptides(db).catch(() => peptides));
      if (!again.ok) return { errors: again.errors };
      return { errors: [cycle.templateId ? TEMPLATE_BLOCKED : INVALID_CYCLE] };
    }
    case "template":
      return { errors: [TEMPLATE_BLOCKED] };
    case "stale":
      return { errors: [CYCLE_CHANGED] };
    case "past":
      return { errors: [PAST_REACHED] };
    case "not_found":
      return { toast: CYCLE_GONE, tone: "error" };
    default:
      return failed();
  }
}
