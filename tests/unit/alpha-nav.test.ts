import { describe, expect, it } from "vitest";
import { activeKey, businessItems, isUnder, sectionNavFor, sidebarFor, tabsFor } from "@/lib/alpha/nav";

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe("app shell navigation (design v3)", () => {
  it("phone tabs: researchers get Library, admins get Business in its place", () => {
    expect(labels(tabsFor("researcher"))).toEqual(["Today", "Cycles", "Progress", "Library", "Me"]);
    expect(labels(tabsFor("admin"))).toEqual(["Today", "Cycles", "Progress", "Business", "Me"]);
  });

  it("laptop sidebar: researcher list; admins get Research and Business groups", () => {
    const researcher = sidebarFor("researcher");
    expect(researcher).toHaveLength(1);
    expect(researcher[0].label).toBeNull();
    expect(labels(researcher[0].items)).toEqual(["Today", "Cycles", "Progress", "Library", "Supplies"]);
    const admin = sidebarFor("admin");
    expect(admin.map((group) => group.label)).toEqual(["Research", "Business"]);
    expect(labels(admin[0].items)).toEqual(["Today", "Cycles", "Progress"]);
    expect(labels(admin[1].items)).toEqual(["Overview", "Stock", "Ledger", "Library", "People"]);
    expect(labels(businessItems())).toEqual(["Overview", "Stock", "Ledger", "Library", "People"]);
  });

  it("maps each destination to an existing route", () => {
    const hrefs = Object.fromEntries(
      [...tabsFor("admin"), ...sidebarFor("researcher")[0].items, ...businessItems()].map((item) => [item.key, item.href]),
    );
    expect(hrefs).toEqual({
      today: "/app/today",
      cycles: "/app/cycles",
      progress: "/app/progress",
      business: "/admin/sales",
      me: "/app/me",
      library: "/app/library",
      supplies: "/app/supplies",
      overview: "/admin/sales",
      stock: "/admin/inventory",
      ledger: "/admin/sales",
      "admin-library": "/admin/library",
      people: "/admin/invitations",
    });
  });

  it("the current tab owns its sub-screens; Me owns the researcher's own pages on the phone", () => {
    const researcher = tabsFor("researcher");
    expect(activeKey(researcher, "/app/today")).toBe("today");
    expect(activeKey(researcher, "/app/cycles/abc/edit")).toBe("cycles");
    expect(activeKey(researcher, "/app/calculator")).toBe("cycles");
    expect(activeKey(researcher, "/app/library/peptides/x")).toBe("library");
    for (const path of ["/app/me", "/app/notifications", "/app/supplies", "/app/supplements"]) {
      expect(activeKey(researcher, path)).toBe("me");
    }
    expect(activeKey(researcher, "/app/todays")).toBeNull();

    const admin = tabsFor("admin");
    for (const path of ["/admin/sales", "/admin/inventory/purchase", "/admin/templates", "/admin/support/1"]) {
      expect(activeKey(admin, path)).toBe("business");
    }
    expect(activeKey(admin, "/app/library")).toBeNull();
  });

  it("the laptop sidebar highlights Supplies, and Business destinations own their pages", () => {
    expect(activeKey(sidebarFor("researcher")[0].items, "/app/supplements")).toBe("supplies");
    expect(activeKey(sidebarFor("researcher")[0].items, "/app/me")).toBeNull();
    const business = businessItems();
    expect(activeKey(business, "/admin/sales/outside")).toBe("overview");
    expect(activeKey(business, "/admin/inventory/abc")).toBe("stock");
    expect(activeKey(business, "/admin/templates")).toBe("admin-library");
    expect(activeKey(business, "/admin/support/abc")).toBe("people");
    expect(activeKey(business, "/admin/design")).toBeNull();
  });

  it("Overview and Ledger share Sales until V5 / V6: the one chosen is current, never both", () => {
    const business = businessItems();
    const sidebar = sidebarFor("admin").flatMap((group) => group.items);
    for (const items of [business, sidebar]) {
      expect(activeKey(items, "/admin/sales")).toBe("overview");
      expect(activeKey(items, "/admin/sales", "ledger")).toBe("ledger");
      expect(activeKey(items, "/admin/sales/outside", "ledger")).toBe("ledger");
      expect(activeKey(items, "/admin/sales", "overview")).toBe("overview");
      // A choice that doesn't own the page is ignored.
      expect(activeKey(items, "/admin/sales", "stock")).toBe("overview");
      expect(activeKey(items, "/admin/inventory", "ledger")).toBe("stock");
    }
  });

  it("section links group the pages a later slice merges", () => {
    expect(sectionNavFor("/admin/templates")).toMatchObject({ label: "Library" });
    expect(labels(sectionNavFor("/admin/library")!.links)).toEqual(["Peptides", "Templates"]);
    expect(labels(sectionNavFor("/admin/support/abc")!.links)).toEqual(["Invitations", "Support"]);
    expect(sectionNavFor("/admin/inventory")).toBeNull();
    expect(sectionNavFor("/app/library")).toBeNull();
  });

  it("isUnder matches a path and its sub-paths only", () => {
    expect(isUnder("/app/today", "/app/today")).toBe(true);
    expect(isUnder("/app/today/x", "/app/today")).toBe(true);
    expect(isUnder("/app/todayx", "/app/today")).toBe(false);
  });
});
