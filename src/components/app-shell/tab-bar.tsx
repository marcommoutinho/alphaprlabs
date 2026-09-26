"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppSide } from "@/lib/app/identity";
import { activeNavKey, navItemsFor } from "./nav";

/** Phone-only bottom tab bar (hidden at >= 760px in CSS). */
export function TabBar({ side }: { side: AppSide }) {
  const pathname = usePathname();
  const active = activeNavKey(side, pathname);

  return (
    <nav aria-label="Main" className="app-tabbar">
      {navItemsFor(side).map(({ key, href, label, icon: Icon }) => {
        const current = key === active;
        return (
          <Link key={key} href={href} className="app-tab" aria-current={current ? "page" : undefined}>
            <Icon className="app-tab-icon" size={20} strokeWidth={current ? 2.25 : 2} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
