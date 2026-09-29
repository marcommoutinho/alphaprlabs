"use client";

import type { ComponentType } from "react";
import AdminLibraryLoading from "@/app/(private)/admin/library/loading";
import StockLoading from "@/app/(private)/admin/inventory/(stock)/loading";
import LedgerLoading from "@/app/(private)/admin/ledger/loading";
import PeopleLoading from "@/app/(private)/admin/people/loading";
import CyclesLoading from "@/app/(private)/app/cycles/loading";
import LibraryLoading from "@/app/(private)/app/library/loading";
import MeLoading from "@/app/(private)/app/me/loading";
import ProgressLoading from "@/app/(private)/app/progress/loading";
import SuppliesLoading from "@/app/(private)/app/supplies/loading";
import TodayLoading from "@/app/(private)/app/today/loading";
import { OverviewSkeleton } from "@/components/business/overview-skeleton";

/**
 * Each navigation item's loading skeleton, by its key (src/lib/alpha/nav.ts):
 * the very component its route shows while loading (the route's loading.tsx,
 * or the Business overview's own Suspense fallback), so the skeleton shown
 * the moment an item is tapped (./pending-nav) is the one the page then
 * streams in behind.
 */
export const ROUTE_SKELETONS: Readonly<Record<string, ComponentType>> = {
  today: TodayLoading,
  cycles: CyclesLoading,
  progress: ProgressLoading,
  library: LibraryLoading,
  supplies: SuppliesLoading,
  me: MeLoading,
  business: OverviewSkeleton,
  overview: OverviewSkeleton,
  stock: StockLoading,
  ledger: LedgerLoading,
  "admin-library": AdminLibraryLoading,
  people: PeopleLoading,
};
