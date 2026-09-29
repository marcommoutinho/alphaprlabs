import { notFound } from "next/navigation";
import { HistoryGate } from "@/components/admin/people/history-gate";
import { HistoryDenied, ResearcherHistoryScreen } from "@/components/admin/people/researcher-history";
import { requireAdmin } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords, listDoseSkips } from "@/lib/doses/service";
import { researcherHistory } from "@/lib/people/view";
import { listCheckIns } from "@/lib/progress/service";
import { canReadResearcher } from "@/lib/support/access";
import { adminPeptideNames, getSupportAccount } from "@/lib/support/service";
import { createClient } from "@/lib/supabase/server";
import HistoryLoading from "./loading";

export const metadata = { title: "Researcher history · Alpha PR Labs" };

type Params = Promise<{ researcherId: string }>;

/**
 * A12 Researcher history, read-only. Access is checked on every request, on
 * the server and in the database: the account must share with the team now,
 * and every record is read as the admin under RLS (can_read_researcher),
 * never with the secret key. The share is checked again after reading, so a
 * stop that lands mid-request shows the denied state rather than a history
 * emptied by RLS. Without a share only the name and email are shown. No
 * write controls; business records are never read here.
 */
export default async function ResearcherHistoryPage({ params }: { params: Params }) {
  const { researcherId } = await params;
  const admin = await requireAdmin(`/admin/people/${encodeURIComponent(researcherId)}`);
  const db = await createClient();
  const account = await getSupportAccount(db, researcherId);
  if (!account) notFound();

  const denied = <HistoryDenied name={account.name} email={account.email} />;
  if (!account.sharedSince || !(await canReadResearcher(db, account.id))) return denied;

  const [cycles, doses, skips, checkIns, peptides] = await Promise.all([
    listCycles(db, account.id),
    listDoseRecords(db, account.id),
    listDoseSkips(db, account.id),
    listCheckIns(db, account.id),
    adminPeptideNames(db),
  ]);
  const still = await getSupportAccount(db, account.id);
  if (!still?.sharedSince || !(await canReadResearcher(db, account.id))) return denied;

  const history = researcherHistory({
    name: still.name,
    sharedSince: still.sharedSince,
    cycles,
    confirmations: confirmationsByCycle(doses, skips),
    checkIns,
    peptides,
    weightUnit: admin.preferences.weightUnit,
    now: new Date(),
  });
  // Shown at once; put back by back/forward without the server, only after a fresh check (HistoryGate).
  return (
    <HistoryGate researcherId={still.id} renderId={crypto.randomUUID()} name={still.name} checking={<HistoryLoading />} denied={denied}>
      <ResearcherHistoryScreen history={history} />
    </HistoryGate>
  );
}
