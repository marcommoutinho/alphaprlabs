"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { signInUrl } from "@/lib/auth/paths";
import { currentAdmin } from "@/lib/auth/session";
import { NAME_TAKEN, validateLibraryEntry } from "@/lib/library/entry";
import { saveLibraryEntry } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

export type LibraryActionResult = {
  /** Inline validation error under the editor. */
  error?: string;
  /** The field the error belongs to, shown under that field instead. */
  field?: "name";
  toast?: string;
  tone?: "info" | "error";
  /** The entry was saved: close the editor. */
  saved?: boolean;
};

const SAVE_FAILED = "Could not save. Nothing was lost — your entry is still here. Try again.";

/**
 * A2 Save: create or edit a library entry. Every call re-checks that the
 * requester is a signed-in admin; the database function checks it again.
 */
export async function saveLibraryEntryAction(input: unknown): Promise<LibraryActionResult> {
  const admin = await currentAdmin();
  if (!admin) redirect(signInUrl({ next: "/admin/library" }));

  const valid = validateLibraryEntry(input);
  if (!valid.ok) return { error: valid.error };

  const result = await saveLibraryEntry(await createClient(), valid.value);
  switch (result.kind) {
    case "saved":
      refresh();
      return { saved: true, toast: `Library updated · ${valid.value.name}`, tone: "info" };
    case "duplicate_name":
      return { error: NAME_TAKEN, field: "name" };
    case "not_found":
      refresh();
      return { toast: "This entry no longer exists. The list has been refreshed.", tone: "error" };
    default:
      return { toast: SAVE_FAILED, tone: "error" };
  }
}
