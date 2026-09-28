"use client";

import { StockLoadError } from "@/components/business/stock-load-error";

/**
 * Business couldn't load: no figure is shown stale, and the record actions
 * are not offered until the counts load (A6c's rule). Try again re-renders
 * the segment on the server.
 */
export default function BusinessError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <StockLoadError
      title={
        <>
          <span className="laptop:hidden">Business</span>
          <span className="hidden laptop:inline">Overview</span>
        </>
      }
      heading="Couldn't load the business figures"
      error={error}
      retry={unstable_retry}
    />
  );
}
