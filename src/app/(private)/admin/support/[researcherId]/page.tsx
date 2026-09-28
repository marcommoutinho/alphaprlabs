import Link from "@/components/alpha/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-shell/app-shell";
import { ResearcherDenied, ResearcherHistory } from "@/components/admin/support-history";
import { requireAdmin } from "@/lib/auth/session";
import { confirmationsByCycle } from "@/lib/doses/service";
import { canReadResearcher } from "@/lib/support/access";
import { adminPeptideNames, getSupportAccount, readResearcherRecords } from "@/lib/support/service";
import { historyView } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/support.css";

type Params = Promise<{ researcherId: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * A8 Researcher history, read-only. Access is checked on every request, on
 * the server and in the database: the account must be sharing with the team
 * now, and every record is read as the admin under RLS
 * (can_read_researcher), never with the secret key. The share is checked
 * again after reading, so a stop that lands mid-request shows the denied
 * state rather than a history emptied by RLS. No write controls; business
 * stock, sales and push subscriptions are never read. `?full=1` shows every
 * record instead of the most recent ones.
 */
export default async function ResearcherHistoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { researcherId } = await params;
  const full = (await searchParams).full === "1";
  await requireAdmin(`/admin/support/${encodeURIComponent(researcherId)}`);
  const db = await createClient();
  const account = await getSupportAccount(db, researcherId);
  if (!account) notFound();

  const denied = (state: typeof account) => (
    <AppPage width="list">
      <Link href="/admin/support" className="app-a8-back">
        ‹ Support
      </Link>
      <ResearcherDenied account={state} />
    </AppPage>
  );
  if (!account.sharedSince || !(await canReadResearcher(db, account.id))) return denied(account);

  const [records, peptides] = await Promise.all([readResearcherRecords(db, account.id), adminPeptideNames(db)]);
  if (!(await canReadResearcher(db, account.id))) return denied((await getSupportAccount(db, account.id)) ?? account);

  const view = historyView({ ...records, peptides, confirmations: confirmationsByCycle(records.doses), now: new Date(), full });
  return (
    <AppPage width="list">
      <Link href="/admin/support" className="app-a8-back">
        ‹ Support
      </Link>
      <ResearcherHistory account={account} sharedSince={account.sharedSince} view={view} full={full} />
    </AppPage>
  );
}
