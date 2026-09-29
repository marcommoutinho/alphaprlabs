"use client";

import { BUSINESS_PATH } from "@/components/business/frame";
import { StockLoadError } from "@/components/business/stock-load-error";

/** The Ledger couldn't load: no figure is shown stale, and recording waits until counts load (A6c's rule). */
export default function LedgerError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title={
        <>
          <span className="laptop:hidden">Ledger</span>
          <span className="hidden laptop:inline">Sales and purchases</span>
        </>
      }
      heading="Couldn't load the ledger"
      error={error}
      retry={unstable_retry}
      back={{ href: BUSINESS_PATH, label: "Business" }}
    />
  );
}
