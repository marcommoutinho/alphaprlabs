"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import type { SalesPeriod } from "@/lib/inventory/rules";
import { ALL_ITEMS_OPTION, PERIOD_OPTIONS } from "@/lib/inventory/screens";

type Filters = { period: SalesPeriod; item: string };

/**
 * A7 filters (Period and Item) kept in the URL (?period=&item=), so the
 * server renders the matching report. The selects show the new choice at
 * once while the report loads (it dims until then).
 */
export function SalesFilters({
  period,
  item,
  items,
  children,
}: {
  period: SalesPeriod;
  /** A stock item id, or "" for all. */
  item: string;
  items: { id: string; label: string }[];
  /** The report, dimmed while a new filter loads. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<Filters>({ period, item });

  function apply(next: Filters) {
    const params = new URLSearchParams();
    if (next.period !== "all") params.set("period", next.period);
    if (next.item) params.set("item", next.item);
    const query = params.toString();
    startTransition(() => {
      setShown(next);
      router.replace(query ? `/admin/sales?${query}` : "/admin/sales", { scroll: false });
    });
  }

  return (
    <>
      <div className="app-inv-head">
        <h1 className="app-h1">Sales &amp; gross profit</h1>
        <div className="app-inv-filters">
          <select aria-label="Period" value={shown.period} onChange={(e) => apply({ ...shown, period: e.target.value as SalesPeriod })}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select aria-label="Item" value={shown.item} onChange={(e) => apply({ ...shown, item: e.target.value })}>
            <option value="">{ALL_ITEMS_OPTION}</option>
            {items.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="app-inv-report" aria-busy={loading || undefined} data-testid="sales-report">
        {children}
      </div>
    </>
  );
}
