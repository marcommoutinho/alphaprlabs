"use client";

import { STOCK_HREF } from "@/components/business/frame";
import { StockLoadError } from "@/components/business/stock-load-error";

/** Record purchase couldn't load its stock items: no form is offered until they load (A6c's rule). */
export default function RecordPurchaseError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title="Record purchase"
      heading="Couldn't load stock"
      error={error}
      retry={unstable_retry}
      back={{ href: STOCK_HREF, label: "Stock" }}
    />
  );
}
