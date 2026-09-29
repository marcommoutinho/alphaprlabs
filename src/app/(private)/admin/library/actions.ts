"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { changedSince, INVALID_ENTRY, NAME_TAKEN, type PeptideProblems, savedToast, validatePeptide } from "@/lib/library/admin";
import { adminPeptide, lastChange, savePeptide } from "@/lib/library/service";
import { saveRequestHash } from "@/lib/request-hash";
import { createClient } from "@/lib/supabase/server";

export type PeptideActionResult = {
  /** Saved (or replayed): the entry, the version it is at now, and whether it is published. */
  saved?: { id: string; version: number; published: boolean };
  toast?: string;
  /** Nothing was saved: why, shown in the editor (the entry stays as typed). */
  error?: string;
  problems?: PeptideProblems;
  /** Another admin saved it since it was opened (AP038): nothing was saved. */
  changed?: boolean;
  /** The entry no longer exists. */
  gone?: boolean;
  /** No answer: it may have been saved. Retry with the same request key. */
  unsure?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAVE_UNSURE ="Couldn't confirm it was saved. Retry sends the same save, so nothing is saved twice.";
const SAVE_REFUSED = "This entry could not be saved. Reload the page and try again.";
const ENTRY_GONE = "This entry no longer exists. The list has been refreshed.";

/**
 * A9 / D6 Save draft, Publish, Save and publish: `{ ...form, publish,
 * requestKey }`. Every call re-checks that the requester is a signed-in
 * admin; the database function checks it again and every rule, saves only
 * over the version the editor opened (compare-and-set) and replays a retry
 * of the same request key instead of saving twice.
 */
export async function savePeptideAction(input: unknown): Promise<PeptideActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/library" }));

  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const requestKey = typeof raw.requestKey === "string" && UUID.test(raw.requestKey) ? raw.requestKey.toLowerCase() : null;
  if (!requestKey) return { error: INVALID_ENTRY };

  const db = await createClient();
  let published = false;
  if (typeof raw.id === "string" && UUID.test(raw.id)) {
    let current;
    try {
      current = await adminPeptide(db, raw.id);
    } catch {
      return { error: SAVE_UNSURE, unsure: true };
    }
    if (!current) {
      refresh();
      return { gone: true, error: ENTRY_GONE };
    }
    published = current.publishedAt !== null;
  }

  const valid = validatePeptide(raw, published);
  if (!valid.ok) return { error: valid.error, problems: valid.problems };

  const result = await savePeptide(db, { requestKey, requestHash: saveRequestHash({ kind: "peptide", ...valid.value }), entry: valid.value });
  switch (result.kind) {
    case "saved":
      refresh();
      return {
        saved: { id: result.id, version: result.version, published: result.published },
        toast: savedToast(valid.value.name, { published: result.published, wasPublished: published, publish: valid.value.publish }),
      };
    case "changed": {
      const change = valid.value.id ? await lastChange(db, "peptide", valid.value.id).catch(() => null) : null;
      return { changed: true, error: changedSince(change?.changedBy ?? null) };
    }
    case "duplicate_name":
      return { error: NAME_TAKEN, problems: { name: NAME_TAKEN } };
    case "not_found":
      refresh();
      return { gone: true, error: ENTRY_GONE };
    case "unsure":
      return { error: SAVE_UNSURE, unsure: true };
    default:
      return { error: SAVE_REFUSED };
  }
}
