"use client";

import Image from "next/image";
import Link from "@/components/alpha/link";
import { usePathname } from "next/navigation";
import type { AppIdentity } from "@/lib/app/identity";
import { activeKey, sidebarFor } from "@/lib/alpha/nav";
import { useNavChoice } from "./nav-choice";
import { useNavCounts } from "./nav-counts";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import { UserMenu } from "./user-menu";

export type SidebarCount = { text: string; tone: "missed" | "low" };

/**
 * Laptop sidebar (§7.14): 232 px, 1 px `line` on the right, padding 20 14.
 * Logo and "Alpha Research"; group labels 12/600 `ink-3`; items 40 tall,
 * radius 10, 18 px icon and 15 px label; the current item is `surface` with a
 * `line` border at 600. The signed-in person sits at the bottom.
 *
 * The right-aligned counters come from `counts` and from the screens that
 * load them (./nav-counts): Today's overdue doses in `missed` (V1), and
 * Supplies' "low" / "3 low" in `low` (V3, from Today and Supplies).
 * TODO(V5): "3 low" on Stock in `low`.
 */
export function Sidebar({
  identity,
  counts: given = {},
}: {
  identity: AppIdentity;
  /** Right-aligned mono counters by nav item key (e.g. { today: { text: "1", tone: "missed" } }). */
  counts?: Readonly<Record<string, SidebarCount>>;
}) {
  const pathname = usePathname();
  const loaded = useNavCounts();
  const counts = { ...loaded, ...given };
  const groups = sidebarFor(identity.role);
  const { chosen, choose } = useNavChoice();
  const current = activeKey(
    groups.flatMap((group) => group.items),
    pathname,
    chosen,
  );

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-line bg-paper laptop:flex",
        "pt-[calc(20px+env(safe-area-inset-top))] pr-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] pl-[calc(14px+env(safe-area-inset-left))]",
      )}
    >
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <Image src="/logo.jpeg" alt="" width={30} height={30} className="size-[30px] rounded-[8px]" preload />
        <span className="text-[15px] font-semibold">Alpha Research</span>
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="flex flex-col gap-0.5">
            {group.label ? (
              <div className={cn("px-2.5 pb-1.5 text-[12px] font-semibold text-ink-3", index === 0 ? "pt-1.5" : "pt-[18px]")}>
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const active = item.key === current;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => choose(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-2.5 rounded-[10px] border px-2.5 text-[15px]",
                    active
                      ? "border-line bg-surface font-semibold text-ink"
                      : "border-transparent text-ink-2 hover:bg-sunken hover:text-ink",
                  )}
                >
                  <NavIcon name={item.icon} className="size-[18px]" />
                  {item.label}
                  {counts[item.key] ? (
                    <span
                      className={cn(
                        "ml-auto font-mono text-[12px] font-semibold",
                        counts[item.key].tone === "missed" ? "text-missed" : "text-low",
                      )}
                    >
                      {counts[item.key].text}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="pt-3">
        <UserMenu identity={identity} pathname={pathname} />
      </div>
    </aside>
  );
}
