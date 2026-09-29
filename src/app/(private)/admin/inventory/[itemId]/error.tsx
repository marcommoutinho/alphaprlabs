"use client";

import { STOCK_HREF } from "@/components/business/frame";
import { StockLoadError } from "@/components/business/stock-load-error";

/** A4 Stock item · couldn't load: no count shown stale, and recording waits until it loads (as A6c). */
export default function StockItemError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title="Stock item"
      heading="Couldn't load this stock item"
      error={error}
      retry={unstable_retry}
      back={{ href: STOCK_HREF, label: "Stock" }}
    />
  );
}
