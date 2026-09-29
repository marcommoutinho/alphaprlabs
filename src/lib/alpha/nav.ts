// App shell navigation (design v3 README "Navigation", COMPONENTS_AND_THEMING
// §7.13–7.14). Pure: the tab bar, sidebar and section links, mapped to the
// routes that exist today. Rendered by src/components/alpha/shell.
//
//   Phone (< 760 px), docked tab bar:
//     researcher  Today · Cycles · Progress · Library · Me
//     admin       Today · Cycles · Progress · Business · Me
//   Laptop (≥ 760 px), 232 px sidebar:
//     researcher  Today, Cycles, Progress, Library, Supplies
//     admin       Research: Today, Cycles, Progress
//                 Business: Overview, Stock, Ledger, Library, People
//
// Every admin is also a researcher (S3.2): the role, not the area, picks the
// navigation, and both areas show the same shell.
import type { AppRole } from "@/lib/app/identity";

export type NavIcon =
  | "today"
  | "cycles"
  | "progress"
  | "library"
  | "supplies"
  | "me"
  | "business"
  | "overview"
  | "stock"
  | "ledger"
  | "people";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** Path prefixes that make this item current (its route and sub-screens). */
  match: readonly string[];
};

export type NavGroup = { label: string | null; items: readonly NavItem[] };

/** True when `pathname` is `prefix` itself or a path below it. */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// ── Research ────────────────────────────────────────────
const TODAY: NavItem = { key: "today", label: "Today", href: "/app/today", icon: "today", match: ["/app/today"] };
const CYCLES: NavItem = {
  key: "cycles",
  label: "Cycles",
  href: "/app/cycles",
  icon: "cycles",
  // The mix is set in the cycle builder (R4b) and shown on the log sheet; the
  // calculator page stays for a cycle's saved mix (R3's mix row links to it)
  // and belongs to Cycles.
  match: ["/app/cycles", "/app/calculator"],
};
const PROGRESS: NavItem = {
  key: "progress",
  label: "Progress",
  href: "/app/progress",
  icon: "progress",
  match: ["/app/progress"],
};
const LIBRARY: NavItem = { key: "library", label: "Library", href: "/app/library", icon: "library", match: ["/app/library"] };
const SUPPLIES: NavItem = {
  key: "supplies",
  label: "Supplies",
  href: "/app/supplies",
  icon: "supplies",
  // R7 / R13: Supplies is Vials (/app/supplies) and Supplements
  // (/app/supplements), joined by a Vials | Supplements control.
  match: ["/app/supplies", "/app/supplements"],
};
/** The researcher's own pages: highlight Me on the phone. */
const ME: NavItem = {
  key: "me",
  label: "Me",
  href: "/app/me",
  icon: "me",
  match: ["/app/me", "/app/notifications", "/app/install", "/app/supplies", "/app/supplements"],
};

// ── Business (admins) ───────────────────────────────────
const OVERVIEW: NavItem = {
  key: "overview",
  label: "Overview",
  // A1 / A2 Business overview, A13 / D9 12 months (V5).
  href: "/admin/business",
  icon: "overview",
  match: ["/admin/business"],
};
const STOCK: NavItem = { key: "stock", label: "Stock", href: "/admin/inventory", icon: "stock", match: ["/admin/inventory"] };
const LEDGER: NavItem = {
  key: "ledger",
  label: "Ledger",
  // A7 / A14 / D5: sales and purchases by day or month. The old
  // /admin/sales redirects here; its outside buyers page stays under it.
  href: "/admin/ledger",
  icon: "ledger",
  match: ["/admin/ledger", "/admin/sales"],
};
const ADMIN_LIBRARY: NavItem = {
  key: "admin-library",
  label: "Library",
  // A8 / D6 Library: Peptides | Templates (V7). The old /admin/templates
  // redirects to /admin/library/templates.
  href: "/admin/library",
  icon: "library",
  match: ["/admin/library", "/admin/templates"],
};
const PEOPLE: NavItem = {
  key: "people",
  label: "People",
  // A11 / D8 People and A12 a researcher's shared history (V7). The old
  // /admin/invitations and /admin/support addresses redirect here.
  href: "/admin/people",
  icon: "people",
  match: ["/admin/people", "/admin/invitations", "/admin/support"],
};
/** The admin's phone tab for the whole admin area; opens Overview. */
const BUSINESS: NavItem = { key: "business", label: "Business", href: OVERVIEW.href, icon: "business", match: ["/admin"] };

const BUSINESS_ITEMS: readonly NavItem[] = [OVERVIEW, STOCK, LEDGER, ADMIN_LIBRARY, PEOPLE];

/** Phone tab bar, five tabs. */
export function tabsFor(role: AppRole): readonly NavItem[] {
  return role === "admin" ? [TODAY, CYCLES, PROGRESS, BUSINESS, ME] : [TODAY, CYCLES, PROGRESS, LIBRARY, ME];
}

/** Laptop sidebar: one ungrouped list for researchers, Research + Business for admins. */
export function sidebarFor(role: AppRole): readonly NavGroup[] {
  if (role === "admin") {
    return [
      { label: "Research", items: [TODAY, CYCLES, PROGRESS] },
      { label: "Business", items: BUSINESS_ITEMS },
    ];
  }
  return [{ label: null, items: [TODAY, CYCLES, PROGRESS, LIBRARY, SUPPLIES] }];
}

/** The Business destinations, as the phone shows them inside the Business tab. */
export function businessItems(): readonly NavItem[] {
  return BUSINESS_ITEMS;
}

/**
 * The key of the item that owns `pathname`, or null. Should two items ever
 * own the same page (Overview and Ledger shared Sales & gross profit until
 * V5), `chosen`, the item the person last picked, wins when it is one of
 * them, so exactly one item is current and it is the one they clicked;
 * otherwise the first owner.
 */
export function activeKey(
  items: readonly { key: string; match: readonly string[] }[],
  pathname: string,
  chosen: string | null = null,
): string | null {
  const owners = items.filter((item) => item.match.some((prefix) => isUnder(pathname, prefix)));
  return (owners.find((item) => item.key === chosen) ?? owners[0])?.key ?? null;
}

export type AccountLink = {
  label: string;
  href: string;
  /**
   * The install guide: shown only in a browser tab, never in the installed
   * app, and named for the device ("Install the app" on a phone, "Get the
   * app on your phone" on a laptop). Decided in the browser.
   */
  install?: true;
  /**
   * A tool that belongs to another section (the vial calculator is under
   * Cycles): listed for reach, but its page doesn't make the account menu
   * current.
   */
  tool?: true;
};

/**
 * The signed-in person's account pages, in the laptop user menu (the phone
 * reaches them from Me). Sign out follows them.
 */
export const ACCOUNT_LINKS: readonly AccountLink[] = [
  { label: "Profile & support access", href: "/app/me" },
  { label: "Notifications", href: "/app/notifications" },
  { label: "Personal supplies", href: "/app/supplies" },
  { label: "Supplements", href: "/app/supplements" },
  // Marco, 2026-09-29: the calculator within reach from Cycles, Me and here.
  { label: "Vial calculator", href: "/app/calculator", tool: true },
  { label: "Install the app", href: "/app/install", install: true },
];

/** The role word under the name in the sidebar. */
export function roleLabel(role: AppRole): string {
  return role === "admin" ? "Admin" : "Researcher";
}
