// S6 server actions for A5 Record purchase and A6 Record sale (V6: the A4 / A5 sheets), against the
// real local Supabase (npm run db:start). The actions run as the signed-in
// person (RLS and the database functions apply); only the request's cookie
// session is swapped for a signed-in client. Values go in as the strings a
// form sends. Every test uses its own library peptide (unique name).
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINK_ACCOUNT_REQUIRED,
  PURCHASE_ALREADY_RECORDED,
  SALE_ALREADY_RECORDED,
  SALE_DATE_FUTURE,
  SELLER_NOT_ADMIN,
  SELLER_REQUIRED,
  stockChangedMessage,
  VIALS_INVALID,
} from "@/lib/inventory/rules";
import { businessToday } from "@/lib/inventory/screens";
import { LINK_NOT_LINKABLE } from "@/lib/inventory/seller-screens";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";
import { withPreview } from "../support/previewed-sale";
import type { Db } from "@/lib/inventory/service";
import { savePeptideAs } from "../support/admin-writers";

const acting = vi.hoisted(() => ({ client: null as unknown, refreshed: 0, revalidated: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({
  refresh: () => void acting.refreshed++,
  revalidatePath: (path: string) => void acting.revalidated.push(path),
}));

const { linkSaleAction, recordPurchaseAction, recordSaleAction: recordSaleAsSent } = await import("@/app/(private)/admin/inventory/actions");
/** The Record sale action, sent as the sheet sends it: with the lots its preview showed (records.test covers a sale sent without them). */
const recordSaleAction = async (input: Record<string, unknown>) => recordSaleAsSent(await withPreview(acting.client as Db, input));

const admin = { email: uniqueEmail("s6-act-admin"), name: "S6 Action Admin" };
const jordan = { email: uniqueEmail("s6-act-jordan"), name: "Jordan Reyes" };
const researcher = { email: uniqueEmail("s6-act-researcher"), name: "S6 Action Researcher" };
let jordanId: string;
let adminId: string;
let researcherId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
  jordanId = await ensureAccount({ ...jordan, role: "researcher" });
  researcherId = await ensureAccount({ ...researcher, role: "researcher" });
});

beforeEach(async () => {
  acting.client = await signedInClient(admin.email);
  acting.refreshed = 0;
  acting.revalidated = [];
});

/** The pages a recorded purchase or sale must never show from a cached copy. */
const stockPages = (itemId: string) => [`/admin/inventory/${itemId}`, "/admin/inventory", "/admin/ledger", "/admin/business"];

async function newPeptide(): Promise<string> {
  const name = `Compound S6 ${randomBytes(4).toString("hex")}`;
  const { data, error } = await savePeptideAs((await signedInClient(admin.email)), {
    p_name: name,
    p_information: `[Supplied information for ${name}]`,
    p_cycling_off_guidance: "",
    p_supplement_guidance: "",
    p_available: true,
  });
  expect(error).toBeNull();
  return data!;
}

const purchase = (fields: Record<string, string>) => ({ idempotencyKey: randomUUID(), strengthMg: "", peptideId: "", ...fields });
const sale = (stockItemId: string, fields: Record<string, string>) => ({
  idempotencyKey: randomUUID(),
  stockItemId,
  soldOn: "2026-08-25",
  sellerId: adminId,
  buyerType: "outside",
  buyerProfileId: "",
  buyerName: "Outside buyer",
  ...fields,
});
const salesOf = async (stockItemId: string) =>
  (await serviceClient().from("business_sales").select("quantity, revenue, cost, gross_profit, buyer_profile_id").eq("stock_item_id", stockItemId))
    .data!;
const purchasesOf = async (stockItemId: string) =>
  (await serviceClient().from("business_purchases").select("id").eq("stock_item_id", stockItemId)).data!;

describe("A5 and A6 actions for an admin", () => {
  it("the handoff FIFO scenario through the actions, with values as typed", async () => {
    const peptideId = await newPeptide();
    const first = purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: "2026-08-15", quantity: "10", unitCost: "20" });
    const bought = await recordPurchaseAction(first);
    expect(bought).toMatchObject({ toast: "Purchase recorded · 10 vials · $200.00", tone: "info" });
    const itemId = bought.stockItemId!;
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(acting.revalidated).toEqual(stockPages(itemId));

    // The same entry submitted again (a double click or a retry) records once.
    expect(await recordPurchaseAction(first)).toEqual({ stockItemId: itemId, toast: PURCHASE_ALREADY_RECORDED, tone: "warn" });
    expect(await purchasesOf(itemId)).toHaveLength(1);

    expect(
      await recordPurchaseAction(purchase({ stockItemId: itemId, receivedOn: "2026-08-20", quantity: " 10 ", unitCost: "25.00" })),
    ).toMatchObject({ stockItemId: itemId, toast: "Purchase recorded · 10 vials · $250.00" });

    const sold = sale(itemId, { buyerType: "account", buyerProfileId: jordanId, quantity: "12", unitPrice: "40" });
    expect(await recordSaleAction(sold)).toEqual({
      stockItemId: itemId,
      toast: "Sale recorded · 12 vials · $480.00 · gross profit $230.00",
      tone: "info",
    });
    // Each recorded purchase (including the replay) and the sale revalidate the stock pages.
    expect(acting.revalidated).toEqual([1, 2, 3, 4].flatMap(() => stockPages(itemId)));
    expect(await recordSaleAction(sold)).toEqual({ stockItemId: itemId, toast: SALE_ALREADY_RECORDED, tone: "warn" });
    expect(await salesOf(itemId)).toEqual([
      { quantity: 12, revenue: 480, cost: 250, gross_profit: 230, buyer_profile_id: jordanId },
    ]);

    // 8 left: an outside buyer for 9 is refused and nothing is recorded; the page data is refreshed.
    expect(await recordSaleAction(sale(itemId, { buyerName: "K. Osei", quantity: "9", unitPrice: "40" }))).toEqual({
      error: stockChangedMessage(8),
      stockChanged: { onHand: 8 },
    });
    expect(stockChangedMessage(8)).toBe("Stock changed before saving — only 8 on hand now. Nothing was recorded.");
    expect(acting.refreshed).toBe(1);
    expect(await salesOf(itemId)).toHaveLength(1);
  });

  it("validation comes first, and future dates are refused against the business date, not the client's", async () => {
    const peptideId = await newPeptide();
    expect(
      await recordPurchaseAction(purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: "2026-08-15", quantity: "0", unitCost: "20" })),
    ).toEqual({ error: VIALS_INVALID });

    const today = businessToday();
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const future = purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: tomorrow, quantity: "5", unitCost: "0", today: tomorrow });
    expect(await recordPurchaseAction(future)).toEqual({ error: "The date received can't be in the future." });

    // Today is fine; zero-cost purchases and free samples are allowed; a sale
    // may be dated before the purchase whose stock it uses.
    const bought = await recordPurchaseAction({ ...future, idempotencyKey: randomUUID(), receivedOn: today });
    const itemId = bought.stockItemId!;
    expect(bought.toast).toBe("Purchase recorded · 5 vials · $0.00");
    expect(await recordSaleAction(sale(itemId, { soldOn: tomorrow, today: tomorrow, quantity: "1", unitPrice: "0" }))).toEqual({
      error: SALE_DATE_FUTURE,
    });
    expect(await recordSaleAction(sale(itemId, { soldOn: "2026-01-02", quantity: "1", unitPrice: "0" }))).toMatchObject({
      toast: "Sale recorded · 1 vial · $0.00 · gross profit $0.00",
    });
  });

  it("the seller is required and must be a current admin; a refused seller refreshes the page data", async () => {
    const peptideId = await newPeptide();
    const itemId = (await recordPurchaseAction(
      purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: "2026-08-15", quantity: "3", unitCost: "20" }),
    )).stockItemId!;
    expect(await recordSaleAction(sale(itemId, { sellerId: "", quantity: "1", unitPrice: "40" }))).toEqual({ error: SELLER_REQUIRED });
    expect(await recordSaleAction(sale(itemId, { sellerId: researcherId, quantity: "1", unitPrice: "40" }))).toEqual({ error: SELLER_NOT_ADMIN });
    expect(acting.refreshed).toBe(1);
    expect(await salesOf(itemId)).toHaveLength(0);
    expect(await recordSaleAction(sale(itemId, { quantity: "1", unitPrice: "40" }))).toMatchObject({ tone: "info" });
    expect((await serviceClient().from("business_sales").select("seller_id, seller_name").eq("stock_item_id", itemId)).data).toEqual([
      { seller_id: adminId, seller_name: admin.name },
    ]);
  });

  it("links an outside buyer's sale to an account and refreshes the stock item and sales pages", async () => {
    const peptideId = await newPeptide();
    const itemId = (await recordPurchaseAction(
      purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: "2026-08-15", quantity: "3", unitCost: "20" }),
    )).stockItemId!;
    await recordSaleAction(sale(itemId, { buyerName: "J. Reyes", quantity: "1", unitPrice: "40" }));
    const { data } = await serviceClient().from("business_sales").select("id").eq("stock_item_id", itemId).single();
    acting.revalidated = [];
    expect(await linkSaleAction({ saleId: data!.id, profileId: "" })).toEqual({ error: LINK_ACCOUNT_REQUIRED });
    expect(await linkSaleAction({ saleId: data!.id, profileId: jordanId })).toEqual({
      linked: true,
      toast: "Linked 1 sale to Jordan Reyes.",
      tone: "info",
    });
    expect(acting.revalidated).toEqual(["/(private)/admin/inventory/[itemId]", "/admin/ledger", "/admin/ledger/outside", "/admin/business"]);
    // A second click: nothing more to link.
    expect(await linkSaleAction({ saleId: data!.id, profileId: jordanId })).toMatchObject({ linked: true, toast: "This sale was already linked to Jordan Reyes." });
    expect(await linkSaleAction({ saleId: data!.id, profileId: researcherId })).toEqual({ toast: LINK_NOT_LINKABLE });
    expect(await salesOf(itemId)).toEqual([{ quantity: 1, revenue: 40, cost: 20, gross_profit: 20, buyer_profile_id: jordanId }]);

    acting.client = await signedInClient(researcher.email);
    await expect(linkSaleAction({ saleId: data!.id, profileId: researcherId })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("researchers", () => {
  it("cannot record purchases or sales through the actions", async () => {
    const peptideId = await newPeptide();
    const bought = await recordPurchaseAction(
      purchase({ stockItemId: "new", peptideId, strengthMg: "8", receivedOn: "2026-08-15", quantity: "3", unitCost: "20" }),
    );
    const itemId = bought.stockItemId!;

    acting.client = await signedInClient(researcher.email);
    await expect(
      recordPurchaseAction(purchase({ stockItemId: itemId, receivedOn: "2026-08-15", quantity: "3", unitCost: "20" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    await expect(recordSaleAction(sale(itemId, { quantity: "1", unitPrice: "40" }))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(await purchasesOf(itemId)).toHaveLength(1);
    expect(await salesOf(itemId)).toHaveLength(0);
  });
});
