"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { useSignOut } from "@/components/app-shell/use-sign-out";
import { ACCOUNT_LINKS, isUnder, roleLabel } from "@/lib/alpha/nav";
import { initialsOf, type AppIdentity } from "@/lib/app/identity";
import { cn } from "@/lib/utils";
import { useAlphaPortal } from "../root";

const itemClass = cn(
  "flex h-10 w-full cursor-pointer items-center rounded-[10px] px-3 text-left text-[15px] text-ink-2 outline-none select-none",
  "data-highlighted:bg-sunken data-highlighted:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink",
);

/**
 * The signed-in person at the foot of the sidebar (§7.14): a 32 px avatar,
 * name 14/600 and role 12 `ink-3`. It opens the account menu: the person's
 * own pages (on the phone these are under Me) and Sign out. Closes on outside
 * click, Esc and navigation.
 */
export function UserMenu({ identity, pathname }: { identity: AppIdentity; pathname: string }) {
  const container = useAlphaPortal();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const { pending: signingOut, signOut } = useSignOut();
  const onAccountPage = ACCOUNT_LINKS.some((link) => isUnder(pathname, link.href));

  return (
    <Menu.Root open={openAt === pathname} onOpenChange={(open) => setOpenAt(open ? pathname : null)} modal={false}>
      <Menu.Trigger
        data-account-page={onAccountPage || undefined}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-transparent p-2.5 text-left",
          "hover:bg-sunken data-popup-open:bg-sunken data-account-page:border-line data-account-page:bg-surface",
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold text-ink"
        >
          {initialsOf(identity.name)}
        </span>
        <span className="min-w-0 flex-1 text-[14px] leading-tight">
          <span className="block truncate font-semibold">{identity.name}</span>
          <span className="block text-[12px] text-ink-3">{roleLabel(identity.role)}</span>
        </span>
        <span className="sr-only">Account menu</span>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-[70]">
          <Menu.Popup className="w-[264px] rounded-[16px] border border-line bg-surface p-2 text-ink outline-none">
            <div className="border-b border-line px-3 pt-2 pb-3">
              <div className="truncate text-[14px] font-semibold">{identity.name}</div>
              <div className="mt-0.5 truncate font-mono text-[12px] text-ink-3">{identity.email}</div>
            </div>
            <div className="py-1.5">
              {ACCOUNT_LINKS.map((link) => (
                <Menu.LinkItem
                  key={link.href}
                  closeOnClick
                  className={itemClass}
                  aria-current={isUnder(pathname, link.href) ? "page" : undefined}
                  render={<Link href={link.href} />}
                >
                  {link.label}
                </Menu.LinkItem>
              ))}
            </div>
            <Menu.Separator className="mx-1 mb-1.5 h-px bg-line" />
            <Menu.Item className={cn(itemClass, "text-missed data-highlighted:text-missed")} disabled={signingOut} onClick={signOut}>
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
