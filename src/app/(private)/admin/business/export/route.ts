import { currentAdmin } from "@/lib/auth/session";
import { loadTwelveMonths } from "@/lib/business/load";
import { monthsCsv, monthsCsvFilename } from "@/lib/business/overview";
import { businessToday } from "@/lib/inventory/screens";
import { CSV_TYPE } from "@/lib/progress/csv";
import { createClient } from "@/lib/supabase/server";

/**
 * D9 "Export CSV" (GET /admin/business/export): the 12-month table as a
 * download, newest month first, CAD amounts as exact decimals. Admins only
 * (checked here and again by every database read). Never cached.
 */
export async function GET(): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return new Response("Only admins can export business figures.", { status: 403, headers: noStore("text/plain; charset=utf-8") });

  let file;
  try {
    const { months, sameDays } = await loadTwelveMonths(await createClient(), businessToday());
    file = { csv: monthsCsv(months, sameDays), filename: monthsCsvFilename(months) };
  } catch {
    return new Response("Couldn't export right now. Try again.", { status: 500, headers: noStore("text/plain; charset=utf-8") });
  }
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
