"use client";

import { BUSINESS_PATH } from "@/components/business/frame";
import { StockLoadError } from "@/components/business/stock-load-error";

/** A6c Stock · couldn't load: counts are never shown stale, and recording is paused until they load. */
export default function StockError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title="Stock"
      heading="Couldn't load stock"
      error={error}
      retry={unstable_retry}
      back={{ href: BUSINESS_PATH, label: "Business" }}
    />
  );
}
