"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppIdentity } from "@/lib/app/identity";
import { AccountMenu } from "./account-menu";
import { activeNavKey, navItemsFor } from "./nav";

/**
 * Desktop (>= 760px): sticky 64px bar with logo, main nav and account button.
 * Phone (< 760px): 56px bar with the logo and the avatar menu; the main nav
 * moves to the bottom tab bar. Layout switches in CSS only.
 */
export function AppHeader({ identity }: { identity: AppIdentity }) {
  const pathname = usePathname();
  const active = activeNavKey(identity.role, pathname);
  const items = navItemsFor(identity.role).filter((item) => !item.phoneOnly);

  return (
    <header className="app-header">
      <div className="app-header-start">
        <Image className="app-logo" src="/logo.jpeg" alt="Alpha PR Labs" width={30} height={30} priority />
        <nav aria-label="Main" className="app-topnav">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="app-topnav-link"
              aria-current={item.key === active ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <AccountMenu identity={identity} pathname={pathname} />
    </header>
  );
}
