// S13 reminder dispatcher (src/lib/reminders/dispatch.ts). Vercel Cron calls
// it every minute (vercel.json, Pro plan) with `Authorization: Bearer
// $CRON_SECRET`; anything else gets 401. Locally, `npm run reminders:tick`
// calls it every minute the same way.
//
// REMINDERS_ENABLED is the send on/off control: unless it is exactly "true"
// the call does nothing at all (no planning, no sends) and answers
// { enabled: false }. A missed, duplicate or overlapping call is safe: jobs
// are planned idempotently, claimed under leases with SKIP LOCKED, and a
// call only records outcomes under its own lease. Route handlers aren't
// cached, and this one reads the request's headers, so every call runs.
import { cronAuthorized } from "@/lib/cron-auth";
import { defaultPushDeps } from "@/lib/push/send";
import { dispatchReminders } from "@/lib/reminders/dispatch";
import { remindersEnabled } from "@/lib/reminders/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
/** Seconds. The dispatcher claims no new batch after 40 s and each send times out after 10 s. */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request, "reminder dispatcher")) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!remindersEnabled()) return Response.json({ enabled: false });

  const push = defaultPushDeps();
  if (!push) {
    console.error("Reminders are on but VAPID keys are not set: nothing was sent.");
    return Response.json({ enabled: true, error: "push not configured" }, { status: 500 });
  }
  try {
    const summary = await dispatchReminders({ db: createAdminClient(), push });
    // Host logs are the run history (plan: no new dashboard); reminder_jobs holds each outcome.
    console.info(`Reminder dispatch: ${JSON.stringify(summary)}`);
    return Response.json({ enabled: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Reminder dispatch failed: ${message}`);
    return Response.json({ enabled: true, error: message }, { status: 500 });
  }
}
