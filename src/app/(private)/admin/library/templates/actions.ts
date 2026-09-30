"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { changedSince, savedToast } from "@/lib/library/admin";
import { lastChange } from "@/lib/library/service";
import { saveRequestHash } from "@/lib/request-hash";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATE_UPDATED } from "@/lib/templates/display";
import { INVALID_TEMPLATE, validateTemplate, validateTemplateShape } from "@/lib/templates/rules";
import { listTemplatePeptides, saveTemplate, storedTemplatePeptides } from "@/lib/templates/service";

export type TemplateActionResult = {
  /** Saved (or replayed): the template, the version it is at now, and whether it is published. */
  saved?: { id: string; version: number; published: boolean };
  toast?: string;
  /** Nothing was saved: why, shown above the editor's footer (the entry stays as typed). */
  error?: string;
  /** Every validation message, in the design's order. */
  errors?: string[];
  /** Another admin saved it since it was opened (AP038). */
  changed?: boolean;
  /** The template no longer exists. */
  gone?: boolean;
  /** No answer: it may have been saved. Retry with the same request key. */
  unsure?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAVE_UNSURE = "Couldn't confirm it was saved. Retry sends the same save, so nothing is saved twice.";
const TEMPLATE_GONE = "This template no longer exists. The list has been refreshed.";

/**
 * D7 Save draft, Publish, Save and publish, Move to draft: `{ ...form,
 * version, publish, requestKey }` (version null for a new template; publish
 * the state it is left in: true published, false a draft, hidden from
 * researchers, also when it was published). Draft and publish run the same
 * rules; the difference is visibility only. Every call re-checks that the
 * requester is a signed-in admin. Only the submission's shape is checked
 * here; the database function first replays a retry of the same request key
 * (even if the library or the template has changed since), then saves only
 * over the version the editor opened (compare-and-set, AP038), and only then
 * checks the rules on the library as it is now: each peptide exists and is
 * offered unless the stored template already names it (Marco, 2026-09-26:
 * kept, never newly added). Those refusals are reworded here afterwards.
 */
export async function saveTemplateAction(input: unknown): Promise<TemplateActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/library/templates" }));

  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const requestKey = typeof raw.requestKey === "string" && UUID.test(raw.requestKey) ? raw.requestKey.toLowerCase() : null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const version = raw.version === null || raw.version === undefined ? null : Number.isSafeInteger(raw.version) && (raw.version as number) > 0 ? (raw.version as number) : NaN;
  const publish = typeof raw.publish === "boolean" ? raw.publish : null;
  if (!requestKey || publish === null || Number.isNaN(version) || (id !== null) !== (version !== null)) return { error: INVALID_TEMPLATE, errors: [INVALID_TEMPLATE] };

  const db = await createClient();
  const load = () => Promise.all([listTemplatePeptides(db), storedTemplatePeptides(db, id)]);
  // Names only word the messages; which peptides are offered now is the database's check.
  const names = await listTemplatePeptides(db)
    .then((peptides) => new Map(peptides.map((peptide) => [peptide.id, peptide.name])))
    .catch(() => new Map<string, string>());
  const valid = validateTemplateShape(input, names);
  if (!valid.ok) return { error: valid.error, errors: valid.errors };

  const requestHash = saveRequestHash({ kind: "template", version, publish, ...valid.value });
  const result = await saveTemplate(db, { requestKey, requestHash, version, publish, template: valid.value });
  switch (result.kind) {
    case "saved":
      refresh();
      return {
        saved: { id: result.id, version: result.version, published: result.published },
        // A published template saved again: future copies only. Published now, or a draft: the library's wording.
        toast: result.published && !result.newlyPublished ? TEMPLATE_UPDATED : savedToast(valid.value.name, result),
      };
    case "changed": {
      const change = valid.value.id ? await lastChange(db, "template", valid.value.id).catch(() => null) : null;
      return { changed: true, error: changedSince(change?.changedBy ?? null) };
    }
    case "unavailable": {
      // Not offered (or not in the library) and not already named: say which.
      const again = await load()
        .then(([fresh, stored]) => validateTemplate(input, fresh, stored))
        .catch(() => null);
      return again && !again.ok ? { error: again.error, errors: again.errors } : { error: INVALID_TEMPLATE, errors: [INVALID_TEMPLATE] };
    }
    case "not_found":
      refresh();
      return { gone: true, error: TEMPLATE_GONE };
    case "unsure":
      return { error: SAVE_UNSURE, unsure: true };
    default:
      return { error: INVALID_TEMPLATE, errors: [INVALID_TEMPLATE] };
  }
}
