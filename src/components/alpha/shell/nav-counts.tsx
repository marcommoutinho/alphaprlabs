"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type NavCount = { text: string; tone: "missed" | "low" };

/** A "low" counter (§7.14, Supplies): "low" for one, "3 low" for more, none for 0. */
export const lowCounter = (count: number): NavCount | null => (count > 0 ? { text: count === 1 ? "low" : `${count} low`, tone: "low" } : null);
type NavCounts = { counts: Readonly<Record<string, NavCount>>; set: (key: string, count: NavCount | null) => void };

const NavCountsContext = createContext<NavCounts>({ counts: {}, set: () => {} });

/**
 * The sidebar's right-aligned counters (§7.14), set by the screens that load
 * those numbers (V1: Today's overdue doses). A counter keeps its last value
 * while the person moves to other screens, until that screen loads again.
 */
export function NavCountsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Record<string, NavCount>>({});
  const set = (key: string, count: NavCount | null) =>
    setCounts((current) => {
      const now = current[key];
      if (count === null ? !now : now && now.text === count.text && now.tone === count.tone) return current;
      const next = { ...current };
      if (count === null) delete next[key];
      else next[key] = count;
      return next;
    });
  return <NavCountsContext value={{ counts, set }}>{children}</NavCountsContext>;
}

export function useNavCounts(): Readonly<Record<string, NavCount>> {
  return useContext(NavCountsContext).counts;
}

/** Shows `count` beside the sidebar item `key` (null: none). */
export function useNavCount(key: string, count: NavCount | null) {
  const { set } = useContext(NavCountsContext);
  const text = count?.text ?? null;
  const tone = count?.tone ?? null;
  useEffect(() => {
    set(key, text !== null && tone !== null ? { text, tone } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, text, tone]);
}
