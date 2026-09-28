"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/app/identity";
import { activeKey, tabsFor } from "@/lib/alpha/nav";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";

/**
 * Phone tab bar (§7.13, Tab Bar.dc.html): solid `paper`, docked, 1 px `line`
 * on top, five equal columns 54 px tall plus the home-indicator inset. Active:
 * `ink`, label 600 and a 28 × 2 bar on the top edge; inactive `ink-3`. Hidden
 * from 760 px, where the sidebar takes over.
 */
export function TabBar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const tabs = tabsFor(role);
  const current = activeKey(tabs, pathname);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "app-tabbar fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-line bg-paper laptop:hidden",
        "pr-[max(6px,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(6px,env(safe-area-inset-left))]",
      )}
    >
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-[54px] min-w-0 flex-col items-center justify-center gap-1 text-[12px] tracking-[-0.005em]",
              "focus-visible:-outline-offset-2",
              active ? "font-semibold text-ink" : "font-medium text-ink-3",
            )}
          >
            <span
              aria-hidden
              className={cn("absolute -top-px h-0.5 w-7 rounded-[2px]", active ? "bg-ink" : "bg-transparent")}
            />
            <NavIcon name={tab.icon} className="size-[22px]" strokeWidth={2} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
