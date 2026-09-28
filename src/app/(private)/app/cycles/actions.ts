"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import {
  CYCLE_CHANGED,
  CYCLE_GONE,
  CYCLE_SAVED,
  editIssueMessage,
  FUTURE_PLAN_UPDATED,
  MIX_CHANGED,
  PAST_REACHED,
  TEMPLATE_GONE,
} from "@/lib/cycles/display";
import { type RevisedPlan, reviseCycle } from "@/lib/cycles/revise";
import { type CycleForm, type CyclePeptide, INVALID_CYCLE, readCycleForm, validateCycle } from "@/lib/cycles/rules";
import {
  type CycleMix,
  getCycle,
  getTemplateForCopy,
  listCyclePeptides,
  replayedSave,
  type SaveRequest,
  saveCycleWithMixes,
  saveRequestHash,
} from "@/lib/cycles/service";
import { cycleConfirmations } from "@/lib/doses/service";
import { validateMixture, VIAL_STRENGTH_TRACKED } from "@/lib/mixtures/rules";
import { createClient } from "@/lib/supabase/server";

export type CycleActionResult = {
  /** The builder's issues, in order (it shows the first, plus "(+N more)"). */
  errors?: string[];
  /** A failure that isn't the form's: shown as an error toast. */
  toast?: string;
  /** Saved: the builder opens the cycle and says so. */
  saved?: boolean;
  cycleId?: string;
  message?: string;
};

const failed = (): CycleActionResult => ({ toast: SAVE_FAILED_MESSAGE });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each peptide's mix entry as sent (R4b): at most one per peptide of the
 * cycle; `set` checked with the saved-mixture rules (a complete setup, a new
 * mixture or a saved one at the version shown); `keep` / `remove` name the
 * plan's mixture at the version shown. Null when the structure is malformed.
 */
function readMixes(input: unknown, form: CycleForm, nameOf: (id: string) => string): { mixes: CycleMix[]; errors: string[] } | null {
  const raw = (input as { mixes?: unknown } | null)?.mixes ?? [];
  if (!Array.isArray(raw) || raw.length > form.plans.length) return null;
  const peptides = new Set(form.plans.map((plan) => plan.peptideId));
  const seen = new Set<string>();
  const mixes: CycleMix[] = [];
  const errors: string[] = [];
  for (const entry of raw) {
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const peptideId = typeof e.peptideId === "string" ? e.peptideId.toLowerCase() : "";
    if (!peptides.has(peptideId) || seen.has(peptideId)) return null;
    seen.add(peptideId);
    if (e.kind === "keep" || e.kind === "remove") {
      if (typeof e.mixtureId !== "string" || !UUID.test(e.mixtureId) || !Number.isSafeInteger(e.version) || (e.version as number) < 1) return null;
      mixes.push({ kind: e.kind, peptideId, mixtureId: e.mixtureId.toLowerCase(), version: e.version as number });
      continue;
    }
    if (e.kind !== "set") return null;
    const setup = (typeof e.setup === "object" && e.setup !== null ? e.setup : {}) as Record<string, unknown>;
    const valid = validateMixture({ ...setup, peptideId, mixtureId: e.mixtureId ?? null, version: e.version ?? null, planIds: [] });
    if (!valid.ok) {
      errors.push(...valid.errors.map((error) => `${nameOf(peptideId)}: ${error}`));
      continue;
    }
    mixes.push({ kind: "set", peptideId, mixtureId: valid.value.mixtureId, version: valid.value.version, setup: valid.value.setup });
  }
  return { mixes, errors };
}

/**
 * The submission's identity (saveCycleWithMixes' SaveRequest): the key the
 * builder made for it, and the hash of everything else it sent. Null when
 * the key is missing or malformed.
 */
function readRequest(input: unknown): SaveRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const { requestKey, ...submission } = input as Record<string, unknown>;
  if (typeof requestKey !== "string" || !UUID.test(requestKey)) return null;
  return { key: requestKey.toLowerCase(), hash: saveRequestHash(submission) };
}

function saved(cycleId: string, edit: boolean): CycleActionResult {
  revalidatePath("/app/cycles", "layout");
  revalidatePath("/app/today");
  revalidatePath("/app/calculator");
  return { saved: true, cycleId, message: edit ? FUTURE_PLAN_UPDATED : CYCLE_SAVED };
}

/**
 * The builder's save (R4's review "Start cycle", or an edit's "Save future
 * changes"): create a cycle (custom, or copied from a template) or save an
 * edit as the next revision, for the signed-in, acknowledged researcher (or
 * admin using the research side) and only for their own cycles, with each
 * peptide's mix (R4b) saved in the same transaction. Validates with the
 * builder's rules and the S7 engine; an edit changes future doses only
 * (reviseCycle). save_cycle() re-checks ownership and every structural rule.
 *
 * Idempotent: `requestKey` is made once per submission in the builder and
 * sent again when it retries the same details, so a retry after a save whose
 * answer was lost returns that save (checked first: an edit's version has
 * moved on since) and never saves twice.
 */
export async function saveCycleAction(input: unknown): Promise<CycleActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: "/app/cycles" }));

  const db = await createClient();
  const form = readCycleForm(input);
  const request = readRequest(input);
  if (!request) return { errors: [INVALID_CYCLE] };
  let replay;
  try {
    replay = await replayedSave(db, request);
  } catch {
    return failed();
  }
  if (replay.kind === "saved") return saved(replay.id, Boolean(form?.cycleId));
  if (replay.kind !== "new") return failed();

  // The library, plus (for a template copy) the peptides that template names:
  // the copy keeps them even when no longer offered.
  const templateId = form && form.cycleId === null ? form.templateId : null;
  const load = async (): Promise<{ peptides: CyclePeptide[]; copied: Set<string> } | "gone"> => {
    const [library, template] = await Promise.all([listCyclePeptides(db), templateId ? getTemplateForCopy(db, templateId) : null]);
    if (templateId && !template) return "gone";
    const named = template?.peptides ?? [];
    const known = new Set(library.map((peptide) => peptide.id));
    return { peptides: [...library, ...named.filter((peptide) => !known.has(peptide.id))], copied: new Set(named.map((peptide) => peptide.id)) };
  };
  let loaded;
  try {
    loaded = await load();
  } catch {
    return failed();
  }
  if (loaded === "gone") return { errors: [TEMPLATE_GONE] };
  const { peptides, copied } = loaded;
  const nameOf = (id: string) => peptides.find((peptide) => peptide.id === id)?.name ?? "Unknown peptide";
  const valid = validateCycle(input, peptides, copied);
  const mixes = form ? readMixes(input, form, nameOf) : null;
  if (!mixes) return { errors: [INVALID_CYCLE] };
  if (!valid.ok || mixes.errors.length) return { errors: [...(valid.ok ? [] : valid.errors), ...mixes.errors] };
  const cycle = valid.value;

  let revised: RevisedPlan[] | undefined;
  if (cycle.cycleId) {
    let current, confirmations;
    try {
      [current, confirmations] = await Promise.all([getCycle(db, cycle.cycleId), cycleConfirmations(db, cycle.cycleId)]);
    } catch {
      return failed();
    }
    // Only the owner edits; a support share reads but never writes.
    if (!current || current.ownerId !== person.id) return { toast: CYCLE_GONE };
    if (current.version !== cycle.version) return { errors: [CYCLE_CHANGED] };
    // Recorded doses and skips: none is ever replaced (save_cycle re-checks with them too).
    const revision = reviseCycle(current.revisions, cycle, new Date(), confirmations);
    if (!revision.ok) return { errors: revision.issues.map((issue) => editIssueMessage(issue, nameOf)) };
    revised = revision.plans;
  }

  let result;
  try {
    result = await saveCycleWithMixes(db, cycle, revised, mixes.mixes, request);
  } catch {
    return failed();
  }
  switch (result.kind) {
    case "saved":
      return saved(result.id, Boolean(cycle.cycleId));
    case "unavailable": {
      // Withdrawn after the check above: say which, from the library as it is now.
      const fresh = await load().catch(() => loaded);
      if (fresh === "gone") return { errors: [TEMPLATE_GONE] };
      const again = validateCycle(input, fresh.peptides, fresh.copied);
      return { errors: again.ok ? [INVALID_CYCLE] : again.errors };
    }
    case "template":
      return { errors: [TEMPLATE_GONE] };
    case "stale":
      return { errors: [CYCLE_CHANGED] };
    case "past":
      return { errors: [PAST_REACHED] };
    case "mixture_stale":
      return { errors: [MIX_CHANGED] };
    case "vial_strength":
      return { errors: [VIAL_STRENGTH_TRACKED] };
    case "not_found":
      return { toast: CYCLE_GONE };
    default:
      return failed();
  }
}
