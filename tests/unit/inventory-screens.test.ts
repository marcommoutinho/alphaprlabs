// S6 inventory screens: the view helpers (labels, the Toronto business date)
// and every designed empty state, rendered to HTML without a database (the
// shared local database always has stock, so the "nothing yet" states can't
// be reached in a browser run).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StockItemView } from "@/components/admin/inventory-views";
import { StockScreen } from "@/components/business/stock-screen";

vi.mock("@/app/(private)/admin/inventory/actions", () => ({ setStockThresholdAction: async () => ({}) }));
import { accountMatches, allocationSummary, buyerLabel, businessToday, lotNote, NO_PURCHASES, NO_SALES, profitTone, vials } from "@/lib/inventory/screens";
import type { StockItemDetail, StockItemSummary } from "@/lib/inventory/service";

describe("screen helpers", () => {
  it("labels and notes in the designed wording", () => {
    expect(vials(1)).toBe("1 vial");
    expect(vials(12)).toBe("12 vials");
    expect(lotNote({ quantity: 10, allocated: 0 })).toBe("None allocated yet");
    expect(lotNote({ quantity: 10, allocated: 2 })).toBe("2 of 10 allocated to sales · cost locked");
    expect(allocationSummary([{ quantity: 10, unitCost: "20.00" }, { quantity: 2, unitCost: "25.00" }])).toBe(
      "10 × CAD 20.00 + 2 × CAD 25.00",
    );
    expect(buyerLabel({ buyerType: "account", buyerName: "Jordan Reyes" })).toBe("Jordan Reyes (account)");
    expect(buyerLabel({ buyerType: "outside", buyerName: "K. Osei" })).toBe("K. Osei (outside)");
    expect(profitTone("-0.01")).toBe("negative");
    expect(profitTone("0.00")).toBe("zero");
    expect(profitTone("230.00")).toBe("positive");
  });

  it("today is the business date in America/Toronto, whatever the server's zone", () => {
    // 02:30 UTC on Sep 27 is still Sep 26 in Toronto (EDT, UTC−4).
    expect(businessToday(new Date("2026-09-27T02:30:00Z"))).toBe("2026-09-26");
    expect(businessToday(new Date("2026-09-27T04:00:00Z"))).toBe("2026-09-27");
    // Winter (EST, UTC−5): New Year's Eve until 05:00 UTC.
    expect(businessToday(new Date("2027-01-01T04:59:00Z"))).toBe("2026-12-31");
    expect(businessToday(new Date("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
  });

  it("A6 account search matches part of the name or email, any case", () => {
    const jordan = { name: "Jordan Reyes", email: "jordan.reyes@example.test" };
    for (const query of ["", "  ", "jord", "REYES", "reyes@exa", "example.test", "Jordan Reyes · jordan"]) {
      expect(accountMatches(jordan, query), query).toBe(true);
    }
    for (const query of ["osei", "jordan@", "Reyes Jordan"]) expect(accountMatches(jordan, query), query).toBe(false);
  });
});

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const ITEM: StockItemSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  peptideId: "22222222-2222-4222-8222-222222222222",
  peptideName: "Compound A",
  peptideAvailable: true,
  strengthMg: "8",
  label: "Compound A · 8 mg",
  purchased: 0,
  sold: 0,
  onHand: 0,
};

describe("designed empty states, rendered", () => {
  it("A6a Stock with no stock items: 0 vials, the designed words, and Record a purchase as the only action", () => {
    const page = html(createElement(StockScreen, { items: [], initialFilter: "all" }));
    const text = page.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
    expect(text).toContain("0 vials");
    expect(text).toContain("No stock recorded yet");
    expect(text).toContain("Record a purchase to add the first peptide and vial strength. Sales can be recorded once there's stock.");
    expect(page).toMatch(/<button[^>]*>Record a purchase<\/button>/);
    expect(page).not.toContain("/admin/inventory/purchase");
    expect(page).not.toContain("Record sale");
    expect(page).not.toContain('data-testid="stock-table"');
  });

  it("A4 Stock item with no purchases and no sales; Record sale is disabled at 0 on hand", () => {
    const detail: StockItemDetail = { item: ITEM, lots: [], sales: [], salesTruncated: false };
    const page = html(createElement(StockItemView, { detail }));
    expect(page).toContain(NO_PURCHASES);
    expect(page).toContain(NO_SALES);
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Record sale<\/button>/);
  });
});
