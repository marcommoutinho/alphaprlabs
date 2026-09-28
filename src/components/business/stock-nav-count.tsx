"use client";

import { lowCounter, useNavCount } from "@/components/alpha/shell/nav-counts";

/** The sidebar's "3 low" beside Stock (§7.14), from the screen that loaded the stock. */
export function StockNavCount({ low }: { low: number }) {
  useNavCount("stock", lowCounter(low));
  return null;
}
