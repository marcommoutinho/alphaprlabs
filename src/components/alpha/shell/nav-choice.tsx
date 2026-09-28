"use client";

import { createContext, useContext, useState } from "react";

type NavChoice = { chosen: string | null; choose: (key: string) => void };

const NavChoiceContext = createContext<NavChoice>({ chosen: null, choose: () => {} });

/**
 * The navigation item the person last picked, shared by the sidebar, tab bar
 * and Business links. activeKey (src/lib/alpha/nav.ts) uses it only to pick
 * between items that open the same page (Overview and Ledger until V5 / V6).
 */
export function NavChoiceProvider({ children }: { children: React.ReactNode }) {
  const [chosen, choose] = useState<string | null>(null);
  return <NavChoiceContext value={{ chosen, choose }}>{children}</NavChoiceContext>;
}

export function useNavChoice(): NavChoice {
  return useContext(NavChoiceContext);
}
