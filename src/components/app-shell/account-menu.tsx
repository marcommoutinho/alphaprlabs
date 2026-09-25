"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { initialsOf, type AppIdentity } from "@/lib/app/identity";
import { usePortalContainer } from "./app-root";
import { RESEARCHER_ACCOUNT_LINKS, isUnder } from "./nav";

/**
 * Account button + menu. One instance serves both widths: on desktop it shows
 * the avatar, name and "Admin" tag; on phone only the avatar and caret.
 * Closes on outside click, Esc (Base UI) and on any navigation (keyed to the
 * pathname it was opened on).
 */
export function AccountMenu({ identity, pathname }: { identity: AppIdentity; pathname: string }) {
  const container = usePortalContainer();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const links = identity.role === "researcher" ? RESEARCHER_ACCOUNT_LINKS : [];
  const onAccountPage = links.some((link) => isUnder(pathname, link.href));

  return (
    <Menu.Root
      open={openAt === pathname}
      onOpenChange={(open) => setOpenAt(open ? pathname : null)}
      modal={false}
    >
      <Menu.Trigger className="app-account-btn" data-account-page={onAccountPage || undefined}>
        <span className="app-avatar" aria-hidden="true">
          {initialsOf(identity.name)}
        </span>
        <span className="app-account-name">{identity.name}</span>
        {identity.role === "admin" ? <span className="app-account-tag">Admin</span> : null}
        <span className="app-account-label-phone">Account menu</span>
        <span className="app-caret" aria-hidden="true">
          ▾
        </span>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner className="app-menu-positioner" side="bottom" align="end" sideOffset={8}>
          <Menu.Popup className="app-menu">
            <div className="app-menu-head">
              <div className="app-menu-name">{identity.name}</div>
              <div className="app-menu-email">{identity.email}</div>
            </div>
            {links.map((link) => (
              <Menu.LinkItem
                key={link.href}
                className="app-menu-item"
                closeOnClick
                aria-current={isUnder(pathname, link.href) ? "page" : undefined}
                render={<Link href={link.href} />}
              >
                {link.label}
              </Menu.LinkItem>
            ))}
            {links.length > 0 ? <Menu.Separator className="app-menu-divider" /> : null}
            {/* Non-functional until S2 adds authentication. */}
            <Menu.Item className="app-menu-item">Sign out</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
