import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { addDays, monthStart } from "@/lib/business/period";
import { businessToday } from "@/lib/inventory/screens";
import { ledgerHref, readLedgerView } from "@/lib/records/ledger";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The old Sales & gross profit page (A7 before V6): its addresses open the
 * Ledger's Sales. `period=month` is this month (the Ledger's default),
 * `period=prev` last month, anything else all time, which is the month
 * view over the longest span (36 months); `item=` keeps its stock item.
 * Admins only.
 */
export default async function SalesRedirect({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("/admin/sales");
  const params = await searchParams;
  const today = businessToday();
  const item = typeof params.item === "string" ? params.item : undefined;
  const period = params.period;
  const base = readLedgerView({ item }, today);
  if (period === "month") redirect(ledgerHref(base));
  if (period === "prev") redirect(ledgerHref(base, { range: { from: monthStart(today, -1), to: addDays(monthStart(today), -1) } }));
  redirect(ledgerHref(base, { group: "month", range: { from: monthStart(today, -35), to: today } }));
}
