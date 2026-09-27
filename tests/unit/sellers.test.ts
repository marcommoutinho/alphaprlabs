// Sellers, admin invitations and buyer linking (Marco, 2026-09-27): the A6
// seller rule and options, the link input, the labels and copy, the A7
// "By seller" rows and the admin invitation form, without a database.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaleEntry, SalesReportView } from "@/components/admin/inventory-views";
import { InvitationsView } from "@/components/admin/invitations-view";
import { ToastProvider } from "@/components/app-shell/toast";
import {
  LINK_ACCOUNT_REQUIRED,
  SALE_DATE_REQUIRED,
  SELLER_REQUIRED,
  VIALS_INVALID,
  validateLink,
  validateSale,
} from "@/lib/inventory/rules";
import { buyerLabel } from "@/lib/inventory/screens";
import {
  BY_SELLER_TITLE,
  defaultSeller,
  LINK_BUTTON,
  linkedToast,
  linkSameNameLabel,
  NO_SELLER,
  sellerLine,
  sellerOptions,
  sellerRowLabel,
} from "@/lib/inventory/seller-screens";
import type { SellerTotals } from "@/lib/inventory/sellers";
import type { SaleRecord, SalesReport } from "@/lib/inventory/service";
import { ADMIN_CONFIRM_POINTS, invitationRole, ROLE_LABEL } from "@/lib/invitations/state";

const KEY = "0b5b3a3e-6f0e-4c8e-9a51-1f9d7f3b2c10";
const ITEM = "7a51958a-1a5e-4f22-8f55-689ba8ce0a1b";
const MARCO = "5d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6";
const BRIAN = "6e2f3a4b-5c6d-4e7f-8a91-92b3c4d5e6f7";
const TODAY = "2026-09-27";
const error = (result: { ok: boolean; error?: string }) => (result.ok ? "ok" : result.error);

describe("A6 seller", () => {
  const sale = { idempotencyKey: KEY, stockItemId: ITEM, soldOn: "2026-09-20", sellerId: MARCO, quantity: "2", unitPrice: "40", buyerType: "outside", buyerName: "Walk-in" };

  it("is required, as an id, and comes after the date in the designed order", () => {
    expect(validateSale(sale, TODAY)).toMatchObject({ ok: true, value: { sellerId: MARCO } });
    expect(validateSale({ ...sale, sellerId: MARCO.toUpperCase() }, TODAY)).toMatchObject({ ok: true, value: { sellerId: MARCO } });
    for (const sellerId of [undefined, "", " ", "Marco", 7, null, {}, `${MARCO}x`]) {
      expect(error(validateSale({ ...sale, sellerId }, TODAY)), String(sellerId)).toBe(SELLER_REQUIRED);
    }
    expect(error(validateSale({ ...sale, soldOn: "", sellerId: "" }, TODAY))).toBe(SALE_DATE_REQUIRED);
    expect(error(validateSale({ ...sale, sellerId: "", quantity: "0" }, TODAY))).toBe(SELLER_REQUIRED);
    expect(error(validateSale({ ...sale, quantity: "0" }, TODAY))).toBe(VIALS_INVALID);
  });

  it("options: current admins by name, with the email only when two share a name; the signed-in admin first chosen", () => {
    const sellers = [
      { id: BRIAN, name: "Brian", email: "brian@example.test" },
      { id: MARCO, name: "Marco", email: "marco@example.test" },
      { id: KEY, name: " marco", email: "marco2@example.test" },
    ];
    expect(sellerOptions(sellers)).toEqual([
      { id: BRIAN, label: "Brian" },
      { id: MARCO, label: "Marco · marco@example.test" },
      { id: KEY, label: " marco · marco2@example.test" },
    ]);
    expect(defaultSeller(sellers, MARCO)).toBe(MARCO);
    // Not in the list (no longer an admin): nothing preselected, the admin picks one.
    expect(defaultSeller(sellers, ITEM)).toBe("");
  });

  it("labels: the seller line, the A7 row, and a sale from before sellers existed", () => {
    expect(sellerLine({ sellerName: "Natasha" })).toBe("Sold by Natasha");
    expect(sellerLine({ sellerName: null })).toBe(NO_SELLER);
    expect(sellerRowLabel({ sellerName: "Brian" })).toBe("Brian");
    expect(sellerRowLabel({ sellerName: null })).toBe("Seller not recorded");
  });
});

describe("linking an outside buyer's sale", () => {
  it("needs the sale and an account; only an exact true links the same name too", () => {
    const saleId = KEY;
    expect(validateLink({ saleId, profileId: MARCO })).toEqual({ ok: true, value: { saleId, profileId: MARCO, sameName: false } });
    expect(validateLink({ saleId, profileId: MARCO, sameName: true })).toMatchObject({ value: { sameName: true } });
    for (const sameName of ["true", 1, "on", {}]) expect(validateLink({ saleId, profileId: MARCO, sameName })).toMatchObject({ value: { sameName: false } });
    expect(error(validateLink({ saleId, profileId: "" }))).toBe(LINK_ACCOUNT_REQUIRED);
    expect(error(validateLink({ saleId: "x", profileId: MARCO }))).toMatch(/could not be identified/);
    expect(error(validateLink(null))).toMatch(/could not be identified/);
  });

  it("copy: the linked buyer keeps the name it was recorded with; the toast counts the sales", () => {
    expect(buyerLabel({ buyerType: "account", buyerName: "Kwame Osei", originalBuyerName: "K. Osei" })).toBe(
      "Kwame Osei (account · recorded as K. Osei)",
    );
    expect(buyerLabel({ buyerType: "account", buyerName: "Kwame Osei", originalBuyerName: null })).toBe("Kwame Osei (account)");
    expect(buyerLabel({ buyerType: "outside", buyerName: "K. Osei" })).toBe("K. Osei (outside)");
    expect(linkSameNameLabel("K. Osei")).toBe("Also link every other outside sale recorded as “K. Osei”");
    expect(linkedToast(1, "Kwame Osei")).toBe("Linked 1 sale to Kwame Osei.");
    expect(linkedToast(3, "Kwame Osei")).toBe("Linked 3 sales to Kwame Osei.");
    expect(linkedToast(0, "Kwame Osei")).toBe("This sale was already linked to Kwame Osei.");
  });
});

/** Rendered inside the app shell's toast provider (forms use it). */
const html = (element: React.ReactElement) => renderToStaticMarkup(createElement(ToastProvider, null, element));
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const SALE: SaleRecord = {
  id: KEY,
  stockItemId: ITEM,
  soldOn: "2026-09-20",
  quantity: 2,
  unitPrice: "40.00",
  revenue: "80.00",
  cost: "40.00",
  grossProfit: "40.00",
  buyerType: "outside",
  buyerProfileId: null,
  buyerName: "K. Osei",
  originalBuyerName: null,
  sellerId: MARCO,
  sellerName: "Marco",
  recordedAt: "2026-09-20T15:00:00Z",
  allocations: [{ purchaseId: "p1", quantity: 2, unitCost: "20.00", receivedOn: "2026-09-01" }],
};

describe("rendered", () => {
  it("a sale shows its seller; an outside sale offers the link only where accounts are given", () => {
    const account = { id: MARCO, name: "Kwame Osei", email: "kwame@example.test" };
    const plain = text(html(createElement(SaleEntry, { sale: SALE })));
    expect(plain).toContain("gross profit CAD 40.00 · Sold by Marco");
    expect(plain).not.toContain(LINK_BUTTON);
    expect(text(html(createElement(SaleEntry, { sale: SALE, linkAccounts: [account] })))).toContain(LINK_BUTTON);
    const linked = { ...SALE, buyerType: "account" as const, buyerProfileId: MARCO, buyerName: "Kwame Osei", originalBuyerName: "K. Osei" };
    const linkedText = text(html(createElement(SaleEntry, { sale: linked, linkAccounts: [account] })));
    expect(linkedText).toContain("Kwame Osei (account · recorded as K. Osei)");
    expect(linkedText).not.toContain(LINK_BUTTON);
    expect(text(html(createElement(SaleEntry, { sale: { ...SALE, sellerId: null, sellerName: null } })))).toContain(NO_SELLER);
  });

  it("A7 By seller: one row per seller with vials, revenue, cost and gross profit", () => {
    const report: SalesReport = {
      totals: { sales: 3, vials: 5, revenue: "200.00", cost: "90.00", grossProfit: "110.00" },
      byItem: [{ stockItemId: ITEM, label: "Compound A · 8 mg", sales: 3, vials: 5, revenue: "200.00", cost: "90.00", grossProfit: "110.00" }],
      sales: [SALE],
      salesTruncated: false,
      hasPurchases: true,
      hasSales: true,
    };
    const sellers: SellerTotals[] = [
      { sellerId: BRIAN, sellerName: "Brian", sales: 2, vials: 3, revenue: "120.00", cost: "50.00", grossProfit: "70.00" },
      { sellerId: null, sellerName: null, sales: 1, vials: 2, revenue: "80.00", cost: "40.00", grossProfit: "40.00" },
    ];
    const page = html(createElement(SalesReportView, { report, sellers, itemLabels: new Map([[ITEM, "Compound A · 8 mg"]]) }));
    expect(text(page)).toContain(BY_SELLER_TITLE);
    const bySeller = /data-testid="by-seller">(.*?)<h2/.exec(page)?.[1] ?? "";
    expect(text(bySeller)).toBe("Brian3 vialsCAD 120.00CAD 50.00CAD 70.00" + "Seller not recorded2 vialsCAD 80.00CAD 40.00CAD 40.00");
  });
});

describe("invitation roles", () => {
  it("researcher unless exactly admin; anything else is refused", () => {
    expect(invitationRole(undefined)).toBe("researcher");
    expect(invitationRole("researcher")).toBe("researcher");
    expect(invitationRole("admin")).toBe("admin");
    for (const role of ["Admin", "ADMIN", "owner", "", null, 1, true, {}]) expect(invitationRole(role), String(role)).toBeNull();
    expect(ROLE_LABEL).toEqual({ researcher: "Researcher", admin: "Admin" });
    expect(ADMIN_CONFIRM_POINTS[0]).toMatch(/^They'll see all business records: stock, purchases, sales/);
  });

  it("the form offers Researcher (chosen) and Admin; the list shows each invitation's role", () => {
    const row = (role: "researcher" | "admin", email: string) => ({
      id: email,
      name: "Someone",
      email,
      sent: "Sep 27, 2026",
      state: "pending" as const,
      label: "Pending",
      canResend: false,
      role,
    });
    const page = html(createElement(InvitationsView, { rows: [row("admin", "a@example.test"), row("researcher", "r@example.test")] }));
    expect(page).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Researcher<\/button>/);
    expect(page).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Admin<\/button>/);
    expect(text(page)).toContain("Admin · Sent Sep 27, 2026");
    expect(text(page)).toContain("Researcher · Sent Sep 27, 2026");
    // The confirm step only appears after choosing Admin and sending.
    expect(text(page)).not.toContain(ADMIN_CONFIRM_POINTS[0]);
  });
});
