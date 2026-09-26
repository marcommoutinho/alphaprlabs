"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { TEMPLATE_CREATED, TEMPLATE_UPDATED } from "@/lib/templates/display";
import { INVALID_TEMPLATE, validateTemplate } from "@/lib/templates/rules";
import { listTemplatePeptides, saveTemplate, storedTemplatePeptides } from "@/lib/templates/service";
import { createClient } from "@/lib/supabase/server";

export type TemplateActionResult = {
  /** Inline validation error under the editor: the first message plus "(+N more)". */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  /** The template was saved: close the editor. */
  saved?: boolean;
};

const SAVE_FAILED = "Could not save. Nothing was lost — your entry is still here. Try again.";
const TEMPLATE_GONE = "This template no longer exists. The list has been refreshed.";

/**
 * A3 and A2 show what a save changes (the template list, and the library's
 * "referenced by N"). In a Server Action revalidatePath also refreshes the
 * current page (Next 16.2 docs, revalidatePath "Good to know").
 */
function revalidateTemplates() {
  revalidatePath("/admin/templates");
  revalidatePath("/admin/library");
}

/**
 * A3 Save: create or edit a template. Every call re-checks that the requester
 * is a signed-in admin; the database function checks it again, and re-checks
 * every rule, including that each peptide is still offered unless the stored
 * template already names it (Marco, 2026-09-26: kept, never newly added).
 */
export async function saveTemplateAction(input: unknown): Promise<TemplateActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/templates" }));

  const db = await createClient();
  const id = typeof input === "object" && input !== null ? (input as { id?: unknown }).id : null;
  const load = () =>
    Promise.all([listTemplatePeptides(db), storedTemplatePeptides(db, typeof id === "string" ? id : null)]);
  let peptides, kept;
  try {
    [peptides, kept] = await load();
  } catch {
    return { toast: SAVE_FAILED, tone: "error" };
  }
  const valid = validateTemplate(input, peptides, kept);
  if (!valid.ok) return { error: valid.error };

  const result = await saveTemplate(db, valid.value);
  switch (result.kind) {
    case "saved":
      revalidateTemplates();
      return { saved: true, toast: valid.value.id ? TEMPLATE_UPDATED : TEMPLATE_CREATED, tone: "info" };
    case "unavailable": {
      // Withdrawn after the check above: say which, and show the page's current availability.
      revalidateTemplates();
      const again = await load()
        .then(([fresh, stored]) => validateTemplate(input, fresh, stored))
        .catch(() => null);
      return { error: again && !again.ok ? again.error : INVALID_TEMPLATE };
    }
    case "not_found":
      revalidateTemplates();
      return { toast: TEMPLATE_GONE, tone: "error" };
    default:
      return { toast: SAVE_FAILED, tone: "error" };
  }
}
