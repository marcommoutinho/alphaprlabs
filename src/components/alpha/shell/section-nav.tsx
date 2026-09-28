"use client";

import Link from "@/components/alpha/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/app/identity";
import { activeKey, businessItems, isUnder, sectionNavFor } from "@/lib/alpha/nav";
import { cn } from "@/lib/utils";
import { SegmentedLinks } from "../segmented";
import { useNavChoice } from "./nav-choice";

/**
 * Links above a page that the tab bar and sidebar don't reach on their own:
 *
 * - Phone, admin area: the Business destinations (Overview, Stock, Ledger,
 *   Library, People), since the tab bar has one Business tab.
 *   TODO(V5): A1 Business links to Stock, Ledger and the rest from its own
 *   content; this row then goes.
 * - Both widths: the sections of a destination whose pages a later slice
 *   merges (Library: Peptides | Templates; People: Invitations | Support).
 *   TODO(V7): A8 / A11 replace these with their own controls.
 */
export function SectionNav({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const { chosen, choose } = useNavChoice();
  const inBusiness = role === "admin" && isUnder(pathname, "/admin");
  const section = sectionNavFor(pathname);
  if (!inBusiness && !section) return null;

  const business = businessItems();
  const currentBusiness = activeKey(business, pathname, chosen);
  const currentSection = section ? activeKey(section.links, pathname) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-3 pt-3 laptop:mx-auto laptop:w-full laptop:max-w-[1040px] laptop:px-10 laptop:pt-7",
        !section && "laptop:hidden",
      )}
    >
      {inBusiness ? (
        <nav
          aria-label="Business"
          className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] laptop:hidden [&::-webkit-scrollbar]:hidden"
        >
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
            </Link>
          ))}
        </nav>
      ) : null}
      {section ? (
        <SegmentedLinks
          label={section.label}
          links={section.links}
          current={currentSection}
          className="laptop:h-10 laptop:max-w-[360px]"
        />
      ) : null}
    </div>
  );
}
