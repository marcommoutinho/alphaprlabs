import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import { requireAdmin } from "@/lib/auth/session";
import { listSupportAccounts } from "@/lib/support/service";
import { A8_INTRO, A8_NONE, supportRows } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/support.css";

/**
 * A8 Researcher support: only the researchers sharing their history with
 * the Alpha PR Labs team now. Names, emails and share times only
 * (admin_support_researchers checks the admin itself); a history opens only
 * while its researcher shares, checked again on that page.
 */
export default async function SupportPage() {
  await requireAdmin("/admin/support");
  const rows = supportRows(await listSupportAccounts(await createClient()));

  return (
    <AppPage width="support">
      <h1 className="app-h1">Researcher support</h1>
      <p className="app-subtitle">{A8_INTRO}</p>
      {rows.length ? null : <div className="app-a8-none">{A8_NONE}</div>}
      <div className="app-a8-list">
        {rows.map((row) => (
          <Link key={row.id} href={`/admin/support/${row.id}`} className="app-a8-row" data-testid="support-row">
            <span className="app-a8-who">
              <span>
                <b>{row.name}</b> <span className="app-a8-email">· {row.email}</span>
              </span>
              <span className="app-a8-sub">{row.sub}</span>
            </span>
            <span className="app-a8-state">Sharing</span>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
