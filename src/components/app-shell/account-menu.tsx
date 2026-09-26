"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { signOutThisDevice } from "@/components/push/use-reminders";
import { initialsOf, type AppIdentity, type AppSide } from "@/lib/app/identity";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { usePortalContainer } from "./app-root";
import { RESEARCHER_ACCOUNT_LINKS, isUnder, sideSwitchFor } from "./nav";
import { useToast } from "./toast";

const SIGN_OUT_FAILED = "Could not sign out: reminders are still on for this phone. Try again.";

/**
 * Account button + menu. One instance serves both widths: on desktop it shows
 * the avatar, name and (on the admin side) the "Admin" tag; on phone only the
 * avatar and caret. Admins also get the switch between the research side
 * ("Admin") and the back office ("My research"). Closes on outside click, Esc
 * (Base UI) and on any navigation (keyed to the pathname it was opened on).
 */
export function AccountMenu({
  identity,
  side,
  pathname,
}: {
  identity: AppIdentity;
  side: AppSide;
  pathname: string;
}) {
  const container = usePortalContainer();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [signingOut, startSignOut] = useTransition();
  const toast = useToast();
  const links = side === "research" ? RESEARCHER_ACCOUNT_LINKS : [];
  const switchTo = sideSwitchFor(identity.role, side);
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
        {side === "admin" ? <span className="app-account-tag">Admin</span> : null}
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
            {switchTo ? (
              <>
                <Menu.LinkItem className="app-menu-item" closeOnClick render={<Link href={switchTo.href} />}>
                  {switchTo.label}
                </Menu.LinkItem>
                <Menu.Separator className="app-menu-divider" />
              </>
            ) : null}
            <Menu.Item
              className="app-menu-item"
              disabled={signingOut}
              onClick={() =>
                startSignOut(async () => {
                  // Researchers and admins alike: this phone must stop receiving
                  // this account's reminders; if it can't, stay signed in and say so.
                  if ((await signOutThisDevice()) !== "signed-out") {
                    toast(SIGN_OUT_FAILED, "error");
                    return;
                  }
                  // A full load of the sign-in page drops every bit of client state.
                  window.location.replace(SIGN_IN_PATH);
                })
              }
            >
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
