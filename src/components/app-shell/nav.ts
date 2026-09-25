import {
  BookOpen,
  Calculator,
  CalendarCheck,
  ChartGantt,
  CircleUser,
  LayoutTemplate,
  LifeBuoy,
  Mail,
  Package,
  Receipt,
  SquareActivity,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/app/identity";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Path prefixes that highlight this item (its own route and sub-screens). */
  match: readonly string[];
  /** Shown only in the phone tab bar (the researcher's "Me"). */
  phoneOnly?: boolean;
};

export type AccountLink = { label: string; href: string };

export { ROLE_HOME } from "@/lib/auth/paths";

/**
 * Researcher account pages. On desktop they are reached from the account menu
 * (and outline the account button); on phone they highlight the "Me" tab.
 */
export const RESEARCHER_ACCOUNT_LINKS: readonly AccountLink[] = [
  { label: "Profile & support access", href: "/app/me" },
  { label: "Notifications", href: "/app/notifications" },
  { label: "Personal supplies", href: "/app/supplies" },
  { label: "Supplements", href: "/app/supplements" },
];

// Sub-screens added by later slices must live under their parent's prefix
// (e.g. /admin/inventory/<item>, /app/cycles/<id>) or be added to `match`.
const NAV: Record<AppRole, readonly NavItem[]> = {
  admin: [
    { key: "inventory", label: "Inventory", href: "/admin/inventory", icon: Package, match: ["/admin/inventory"] },
    { key: "sales", label: "Sales", href: "/admin/sales", icon: Receipt, match: ["/admin/sales"] },
    { key: "library", label: "Library", href: "/admin/library", icon: BookOpen, match: ["/admin/library"] },
    { key: "templates", label: "Templates", href: "/admin/templates", icon: LayoutTemplate, match: ["/admin/templates"] },
    { key: "invitations", label: "Invitations", href: "/admin/invitations", icon: Mail, match: ["/admin/invitations"] },
    { key: "support", label: "Support", href: "/admin/support", icon: LifeBuoy, match: ["/admin/support"] },
  ],
  researcher: [
    { key: "today", label: "Today", href: "/app/today", icon: CalendarCheck, match: ["/app/today"] },
    { key: "cycles", label: "Cycles", href: "/app/cycles", icon: ChartGantt, match: ["/app/cycles"] },
    { key: "library", label: "Library", href: "/app/library", icon: BookOpen, match: ["/app/library"] },
    { key: "calculator", label: "Calculator", href: "/app/calculator", icon: Calculator, match: ["/app/calculator"] },
    { key: "progress", label: "Progress", href: "/app/progress", icon: SquareActivity, match: ["/app/progress"] },
    {
      key: "me",
      label: "Me",
      href: "/app/me",
      icon: CircleUser,
      match: RESEARCHER_ACCOUNT_LINKS.map((link) => link.href),
      phoneOnly: true,
    },
  ],
};

export function navItemsFor(role: AppRole): readonly NavItem[] {
  return NAV[role];
}

/** True when `pathname` is `prefix` itself or a path below it. */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The key of the nav item that owns `pathname`, or null. */
export function activeNavKey(role: AppRole, pathname: string): string | null {
  const item = NAV[role].find((entry) => entry.match.some((prefix) => isUnder(pathname, prefix)));
  return item?.key ?? null;
}
