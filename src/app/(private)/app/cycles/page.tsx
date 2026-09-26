import Link from "next/link";
import { AppPage } from "@/components/app-shell/app-shell";
import "@/styles/app/cycles.css";

/**
 * R2 Cycles: the header and its two ways into the R3 builder. The list with
 * statuses comes in S10 (cycleSummary in src/lib/cycles/service.ts).
 */
export default function CyclesPage() {
  return (
    <AppPage>
      <div className="app-cyc-list-head">
        <h1 className="app-h1">Cycles</h1>
        <div className="app-cyc-list-actions">
          <Link href="/app/library" className="app-btn app-btn--secondary app-btn--sm">
            From a template
          </Link>
          <Link href="/app/cycles/new" className="app-btn app-btn--primary app-btn--sm">
            Custom cycle
          </Link>
        </div>
      </div>
    </AppPage>
  );
}
