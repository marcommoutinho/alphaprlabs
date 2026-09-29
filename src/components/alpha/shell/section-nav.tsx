"use client";

import Link from "@/components/alpha/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/app/identity";
import { activeKey, businessItems, isUnder } from "@/lib/alpha/nav";
import { cn } from "@/lib/utils";
import { useNavChoice } from "./nav-choice";
import { NavLinkPending, usePendingNav } from "./pending-nav";

/**
 * Phone, admin area: the Business destinations (Overview, Stock, Ledger,
 * Library, People) above the page, since the tab bar has one Business tab
 * and A1 links only to Stock and the Ledger from its content. Pages with
 * their own "‹ Business" bar (A3 Stock, A7 Ledger, A8 Library, A11 People
 * and the screens under them, A4's stock item included) leave it out.
 * Laptops use the sidebar.
 */
const OWN_BACK_BAR = ["/admin/ledger", "/admin/ledger/outside"];
const OWN_BACK_BAR_UNDER = ["/admin/inventory", "/admin/library", "/admin/people"];

export function SectionNav({ role }: { role: AppRole }) {
  // A followed navigation item's page counts from the next frame, before it arrives (./pending-nav).
  const pending = usePendingNav();
  const current = usePathname();
  const pathname = pending?.href ?? current;
  const { chosen, choose } = useNavChoice();
  const ownBar = OWN_BACK_BAR.includes(pathname) || OWN_BACK_BAR_UNDER.some((prefix) => isUnder(pathname, prefix));
  const inBusiness = role === "admin" && isUnder(pathname, "/admin") && !ownBar;
  if (!inBusiness) return null;

  const business = businessItems();
  const currentBusiness = pending && business.some((item) => item.key === pending.key) ? pending.key : activeKey(business, pathname, chosen);

  return (
    <div className="flex flex-col gap-3 px-3 pt-3 laptop:hidden">
      <nav aria-label="Business" className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {business.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            onClick={() => choose(item.key)}
            aria-current={item.key === currentBusiness ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center rounded-chip border border-line bg-surface px-3.5 text-[15px] text-ink",
              "aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:font-semibold aria-[current=page]:text-surface",
            )}
          >
            {item.label}
            <NavLinkPending navKey={item.key} href={item.href} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
