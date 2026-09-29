"use client";

import { LEDGER_HREF } from "@/components/business/frame";
import { StockLoadError } from "@/components/business/stock-load-error";
import { OUTSIDE_TITLE } from "@/lib/inventory/seller-screens";

/** Outside buyers couldn't load: its own title, not the Ledger's (this route sits under it). */
export default function OutsideBuyersError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title={OUTSIDE_TITLE}
      heading="Couldn't load outside buyers"
      note="The server didn't respond. Nothing was linked; every sale stays as it was recorded."
      error={error}
      retry={unstable_retry}
      back={{ href: LEDGER_HREF, label: "Ledger" }}
    />
  );
}
