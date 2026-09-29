import { currentResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { ownerConfirmations } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import { createClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "private, no-store" } as const;

/**
 * The app icon badge (BadgeSync): GET → { count } of the signed-in
 * researcher's doses awaiting confirmation (see pendingDoses), read when the
 * app opens and on return to the foreground. A Route Handler, not a Server
 * Action: the client runs those one at a time through the router, and a
 * navigation made while this read was in flight could be dropped (a tap on
 * Business's Week right after opening it did nothing).
 */
export async function GET(): Promise<Response> {
  const person = await currentResearcher();
  if (!person) return Response.json({ count: null }, { status: 401, headers: noStore });
  const db = await createClient();
  const [cycles, confirmations] = await Promise.all([listCycles(db, person.id), ownerConfirmations(db, person.id)]);
  return Response.json({ count: pendingDoses(cycles, confirmations, new Date()) }, { headers: noStore });
}
