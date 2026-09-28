import { currentResearcher } from "@/lib/auth/session";
import { CSV_TYPE, exportRange } from "@/lib/progress/csv";
import { exportOwnCheckIns } from "@/lib/progress/export";
import { createClient } from "@/lib/supabase/server";

/**
 * D3 "Export CSV" (GET /app/progress/export?from=YYYY-MM-DD&to=YYYY-MM-DD):
 * the signed-in researcher's own check-ins for those days, as a download.
 * Owner-only: the rows are read for the session's own id (see
 * exportOwnCheckIns), whoever else's the session could read. Never cached.
 */
export async function GET(request: Request): Promise<Response> {
  const person = await currentResearcher();
  if (!person) return new Response("Sign in to export your check-ins.", { status: 401, headers: noStore("text/plain; charset=utf-8") });

  const url = new URL(request.url);
  const range = exportRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!range) return new Response("Choose a range of days to export.", { status: 400, headers: noStore("text/plain; charset=utf-8") });

  const db = await createClient();
  let file;
  try {
    file = await exportOwnCheckIns(db, range);
  } catch {
    return new Response("Couldn't export right now. Try again.", { status: 500, headers: noStore("text/plain; charset=utf-8") });
  }
  if (!file) return new Response("Sign in to export your check-ins.", { status: 401, headers: noStore("text/plain; charset=utf-8") });

  return new Response(file.csv, {
    status: 200,
    headers: {
      ...noStore(CSV_TYPE),
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const noStore = (type: string) => ({ "Content-Type": type, "Cache-Control": "private, no-store" });
