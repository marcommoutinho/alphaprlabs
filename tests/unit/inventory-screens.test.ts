// S6 inventory and sales screens: the view helpers (A5 total, A6 live
// preview, labels, the Toronto business date) and every designed empty state,
// rendered to HTML without a database (the shared local database always has
// stock, so the "nothing yet" states can't be reached in a browser run).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InventoryList, SalesReportView, StockItemView } from "@/components/admin/inventory-views";
import { allocateFifo, type FifoLot } from "@/lib/inventory/rules";
import {
  accountMatches,
  allocationSummary,
  buyerLabel,
  businessToday,
  INVENTORY_EMPTY,
  lotNote,
  NO_PURCHASES,
  NO_SALES,
  previewAllocationLine,
  profitTone,
  purchaseRecordedToast,
  purchaseTotal,
  saleRecordedToast,
  salePreview,
  SALES_EMPTY_FILTERED,
  SALES_EMPTY_NO_SALES,
  SALES_EMPTY_NOTHING,
  salesEmptyText,
  salesPeriodOf,
  vials,
} from "@/lib/inventory/screens";
import type { SalesReport, StockItemDetail, StockItemSummary } from "@/lib/inventory/service";

const lot = (purchaseId: string, receivedOn: string, recordedOrder: number, unitCost: string, remaining: number): FifoLot => ({
  purchaseId,
  receivedOn,
  recordedOrder,
  unitCost,
  remaining,
});
// The handoff FIFO scenario: 10 × CAD 20 (Aug 15), then 10 × CAD 25 (Aug 20).
const LOTS = [lot("p2", "2026-08-20", 2, "25.00", 10), lot("p1", "2026-08-15", 1, "20.00", 10)];

describe("A6 live preview", () => {
  it("12 × CAD 40 → revenue 480, FIFO cost 250, gross profit 230, oldest stock first", () => {
    const preview = salePreview({ onHand: 20, lots: LOTS, quantity: "12", unitPrice: "40" });
    expect(preview).toMatchObject({ available: 20, short: false, revenue: "480.00", cost: "250.00", grossProfit: "230.00" });
    expect(preview.allocations.map(previewAllocationLine)).toEqual([
      "10 × CAD 20.00 from the Aug 15, 2026 purchase",
      "2 × CAD 25.00 from the Aug 20, 2026 purchase",
    ]);
    // Exactly the allocation the database makes (same function, same order).
    expect(preview.allocations).toEqual(allocateFifo(LOTS, 12).allocations);
  });

  it("more vials than on hand is short: no cost, no profit, no allocation", () => {
    const preview = salePreview({ onHand: 8, lots: [lot("p2", "2026-08-20", 2, "25.00", 8)], quantity: "9", unitPrice: "40" });
    expect(preview).toMatchObject({ short: true, revenue: "360.00", cost: null, grossProfit: null, allocations: [] });
  });

  it("shows — until the entry gives a value, and while the item's lots load", () => {
    expect(salePreview({ onHand: 20, lots: LOTS, quantity: "", unitPrice: "" })).toMatchObject({
      short: false,
      revenue: null,
      cost: null,
      grossProfit: null,
    });
    for (const quantity of ["0", "1.5", "-2", "abc"]) {
      expect(salePreview({ onHand: 20, lots: LOTS, quantity, unitPrice: "40" }).revenue).toBeNull();
    }
    expect(salePreview({ onHand: 20, lots: LOTS, quantity: "3", unitPrice: "-1" })).toMatchObject({ revenue: null, cost: "60.00" });
    expect(salePreview({ onHand: 20, lots: null, quantity: "3", unitPrice: "40" })).toMatchObject({ revenue: "120.00", cost: null });
  });

  it("a free sample (CAD 0) is a negative gross profit; exact cents, never floats", () => {
    expect(salePreview({ onHand: 20, lots: LOTS, quantity: "1", unitPrice: "0" })).toMatchObject({
      revenue: "0.00",
      cost: "20.00",
      grossProfit: "-20.00",
    });
    expect(salePreview({ onHand: 20, lots: [lot("a", "2026-08-01", 1, "0.10", 20)], quantity: "3", unitPrice: "0.20" })).toMatchObject({
      revenue: "0.60",
      cost: "0.30",
      grossProfit: "0.30",
    });
  });
});

describe("screen helpers", () => {
  it("A5 total purchase cost, or — until vials and cost are valid", () => {
    expect(purchaseTotal("10", "20")).toBe("CAD 200.00");
    expect(purchaseTotal(" 3 ", "0.1")).toBe("CAD 0.30");
    expect(purchaseTotal("10", "0")).toBe("CAD 0.00");
    expect(purchaseTotal("", "20")).toBe("—");
    expect(purchaseTotal("0", "20")).toBe("—");
    expect(purchaseTotal("10", "-1")).toBe("—");
    expect(purchaseTotal("2.5", "20")).toBe("—");
  });

  it("labels, notes and toasts in the designed wording", () => {
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
    expect(purchaseRecordedToast(10, "20.00")).toBe("Purchase recorded · 10 vials at CAD 20.00");
    expect(saleRecordedToast({ quantity: 12, revenue: "480.00", grossProfit: "230.00" })).toBe(
      "Sale recorded · 12 vials · revenue CAD 480.00 · gross profit CAD 230.00",
    );
    expect(salesPeriodOf("month")).toBe("month");
    expect(salesPeriodOf("prev")).toBe("prev");
    expect(salesPeriodOf(undefined)).toBe("all");
    expect(salesPeriodOf(["month"])).toBe("all");
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

  it("A7 empty state for the view", () => {
    const view = (sales: number, hasSales: boolean, hasPurchases: boolean) => ({ totals: { sales }, hasSales, hasPurchases });
    expect(salesEmptyText(view(0, false, false))).toBe(SALES_EMPTY_NOTHING);
    expect(salesEmptyText(view(0, false, true))).toBe(SALES_EMPTY_NO_SALES);
    expect(salesEmptyText(view(0, true, true))).toBe(SALES_EMPTY_FILTERED);
    expect(salesEmptyText(view(3, true, true))).toBeNull();
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
const report = (hasPurchases: boolean, hasSales: boolean): SalesReport => ({
  totals: { sales: 0, vials: 0, revenue: "0.00", cost: "0.00", grossProfit: "0.00" },
  byItem: [],
  sales: [],
  salesTruncated: false,
  hasPurchases,
  hasSales,
});

describe("designed empty states, rendered", () => {
  it("A4 Inventory with no stock items", () => {
    const page = html(createElement(InventoryList, { items: [] }));
    expect(page).toContain(INVENTORY_EMPTY);
    expect(page).not.toContain("Peptide · strength");
    expect(page).toContain("Record purchase");
  });

  it("A4 Stock item with no purchases and no sales; Record sale is disabled at 0 on hand", () => {
    const detail: StockItemDetail = { item: ITEM, lots: [], sales: [], salesTruncated: false };
    const page = html(createElement(StockItemView, { detail }));
    expect(page).toContain(NO_PURCHASES);
    expect(page).toContain(NO_SALES);
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Record sale<\/button>/);
  });

  it("A7: nothing yet, purchases only, and a filter with no sales", () => {
    const labels = new Map<string, string>();
    expect(html(createElement(SalesReportView, { report: report(false, false), itemLabels: labels }))).toContain(SALES_EMPTY_NOTHING);
    expect(html(createElement(SalesReportView, { report: report(true, false), itemLabels: labels }))).toContain(SALES_EMPTY_NO_SALES);
    const filtered = html(createElement(SalesReportView, { report: report(true, true), itemLabels: labels }));
    expect(filtered).toContain(SALES_EMPTY_FILTERED);
    expect(filtered).toContain("CAD 0.00");
    expect(filtered).not.toContain("Sales in this view");
  });
});
