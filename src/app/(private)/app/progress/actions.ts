"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/components/app-shell/toast";
import { signInUrl } from "@/lib/auth/paths";
import { currentResearcher } from "@/lib/auth/session";
import { CHECK_IN_CHANGED, CHECK_IN_INVALID, CHECK_IN_SAVED, NEW_DAY, validateCheckIn } from "@/lib/progress/rules";
import { saveCheckIn } from "@/lib/progress/service";
import { createClient } from "@/lib/supabase/server";

const PROGRESS = "/app/progress";

export type CheckInActionResult = {
  /** Shown under the form. */
  error?: string;
  toast?: string;
  tone?: ToastTone;
  saved?: boolean;
};

/**
 * R9 "Save check-in" / "Update today's check-in", for the signed-in,
 * acknowledged researcher (or admin on the research side) only; a support
 * grant never writes. save_check_in() re-checks the caller, that the day is
 * still today in America/Toronto, and the version shown.
 */
export async function saveCheckInAction(input: unknown): Promise<CheckInActionResult> {
  const person = await currentResearcher();
  if (!person) redirect(signInUrl({ next: PROGRESS }));
  const valid = validateCheckIn(input);
  if (!valid.ok) return { error: valid.error };

  const db = await createClient();
  const result = await saveCheckIn(db, valid.value);
  switch (result.kind) {
    case "saved":
      revalidatePath(PROGRESS);
      // Today's check-in card (V1) hides once today's check-in is saved.
      revalidatePath("/app/today");
      refresh();
      return { saved: true, toast: CHECK_IN_SAVED, tone: "info" };
    case "changed":
      return { error: CHECK_IN_CHANGED };
    case "new_day":
      return { error: NEW_DAY };
    case "invalid":
      return { error: CHECK_IN_INVALID };
    default:
      return { toast: SAVE_FAILED_MESSAGE, tone: "error" };
  }
}
