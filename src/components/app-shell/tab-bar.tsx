"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/app/identity";
import { activeNavKey, navItemsFor } from "./nav";

/** Phone-only bottom tab bar (hidden at >= 760px in CSS). */
export function TabBar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const active = activeNavKey(role, pathname);

  return (
    <nav aria-label="Main" className="app-tabbar">
      {navItemsFor(role).map(({ key, href, label, icon: Icon }) => {
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
