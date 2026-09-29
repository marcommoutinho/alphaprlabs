// Sellers and buyer linking (Marco, 2026-09-27;
// 20260927160000_sellers_admin_invites.sql) against the real local Supabase:
// the seller is required and must be a current admin, replays compare it,
// A7's per-seller totals, and linking an outside buyer's sale to an account
// (admins only, outside → account only, nothing else changes, no access and
// no supplies). Every test uses its own library peptide. The owner-level
// checks (the append-only guard's one exception, 1,050 sales) are in
// sellers-owner.test.ts.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { linkSale, listOutsideBuyers, listOutsideSales, listSellers, listSellerTotals } from "@/lib/inventory/sellers";
import { getSale, getStockItem, listSales, recordPurchase } from "@/lib/inventory/service";
import { recordSale } from "../support/previewed-sale";
import { previewed } from "../support/sales";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;

const people = {
  marco: { email: uniqueEmail("sel-marco"), name: `Marco Seller ${randomBytes(2).toString("hex")}`, role: "admin" as const },
  brian: { email: uniqueEmail("sel-brian"), name: "Brian Seller", role: "admin" as const },
  former: { email: uniqueEmail("sel-former"), name: "Former Admin", role: "admin" as const },
  kwame: { email: uniqueEmail("sel-kwame"), name: "Kwame Osei", role: "researcher" as const },
  other: { email: uniqueEmail("sel-other"), name: "Other Researcher", role: "researcher" as const },
};
const id = {} as Record<keyof typeof people, string>;
const db = {} as Record<keyof typeof people, Client>;

beforeAll(async () => {
  for (const [key, person] of Object.entries(people) as [keyof typeof people, (typeof people)[keyof typeof people]][]) {
    id[key] = await ensureAccount(person);
    db[key] = await signedInClient(person.email);
  }
});

/** A new stock item of its own peptide with `quantity` vials at `unitCost` (received Aug 15). */
async function newItem(quantity = 20, unitCost = "20"): Promise<string> {
  const name = `Seller ${randomBytes(4).toString("hex")}`;
  const peptideId = await ok(
    db.marco.rpc("save_library_peptide", {
      p_name: name,
      p_information: `[Supplied information for ${name}]`,
      p_cycling_off_guidance: "",
      p_supplement_guidance: "",
      p_available: true,
    }),
    "peptide",
  );
  const bought = await recordPurchase(db.marco, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId,
    strengthMg: "8",
    receivedOn: "2026-08-15",
    quantity,
    unitCost,
  });
  if (bought.kind !== "recorded") throw new Error(bought.kind);
  return bought.stockItemId;
}

const sale = (stockItemId: string, sellerId: string, fields: Partial<Parameters<typeof recordSale>[1]> = {}) => ({
  idempotencyKey: randomUUID(),
  stockItemId,
  soldOn: "2026-09-10",
  quantity: 1,
  unitPrice: "40",
  sellerId,
  buyer: { type: "outside" as const, name: "Walk-in" },
  ...fields,
});

async function sold(stockItemId: string, sellerId: string, fields: Partial<Parameters<typeof recordSale>[1]> = {}) {
  const result = await recordSale(db.marco, sale(stockItemId, sellerId, fields));
  if (result.kind !== "recorded") throw new Error(result.kind);
  return result.saleId;
}

const salesOf = async (stockItemId: string) =>
  ok(serviceClient().from("business_sales").select("id").eq("stock_item_id", stockItemId), "sales");

describe("every new sale records its seller, a current admin", () => {
  it("is required: the service and the database refuse a sale without one", async () => {
    const itemId = await newItem();
    const withoutSeller = { ...sale(itemId, id.marco), sellerId: undefined } as unknown as Parameters<typeof recordSale>[1];
    expect(await recordSale(db.marco, withoutSeller)).toEqual({ kind: "invalid" });
    const direct = async (args: Record<string, unknown>) =>
      db.marco.rpc("record_business_sale", await previewed(db.marco, {
        p_idempotency_key: randomUUID(),
        p_stock_item_id: itemId,
        p_sold_on: "2026-09-10",
        p_quantity: 1,
        p_unit_price: "40",
        p_buyer_name: "Walk-in",
        ...args,
      } as Parameters<typeof previewed>[1]));
    expect(await sqlState(direct({}))).toBe("22023");
    expect(await sqlState(direct({ p_seller_id: null }))).toBe("22023");
    expect(await salesOf(itemId)).toEqual([]);
  });

  it("must be a current admin: a researcher, an unknown account or a demoted admin is refused (AP029)", async () => {
    const itemId = await newItem();
    for (const sellerId of [id.kwame, randomUUID()]) {
      expect(await recordSale(db.marco, sale(itemId, sellerId))).toEqual({ kind: "seller_not_admin" });
    }
    // Another admin can be the seller (the one recording the sale need not be).
    const formerSale = sale(itemId, id.former);
    expect((await recordSale(db.marco, formerSale)).kind).toBe("recorded");
    await ok(serviceClient().from("profiles").update({ role: "researcher" }).eq("id", id.former), "demote");
    try {
      expect(await recordSale(db.marco, sale(itemId, id.former))).toEqual({ kind: "seller_not_admin" });
      expect((await listSellers(db.marco)).map((s) => s.id)).not.toContain(id.former);
      // The sale already recorded keeps its seller, and its retry still replays.
      expect(await recordSale(db.marco, formerSale)).toMatchObject({ kind: "recorded", replayed: true });
    } finally {
      await ok(serviceClient().from("profiles").update({ role: "admin" }).eq("id", id.former), "restore");
    }
    expect(await salesOf(itemId)).toHaveLength(1);
  });

  it("keeps the seller and their name at the time of the sale; the seller list is the current admins", async () => {
    const itemId = await newItem();
    const saleId = await sold(itemId, id.brian);
    expect(await getSale(db.marco, saleId)).toMatchObject({ sellerId: id.brian, sellerName: people.brian.name });
    const sellers = await listSellers(db.marco);
    expect(sellers).toEqual(expect.arrayContaining([{ id: id.marco, name: people.marco.name, email: people.marco.email }]));
    expect(sellers.map((s) => s.id)).not.toContain(id.kwame);
  });

  it("a replay compares the seller: the same key with another seller is refused (AP005), with the same one replays", async () => {
    const itemId = await newItem();
    const input = sale(itemId, id.marco, { quantity: 2 });
    const first = await recordSale(db.marco, input);
    if (first.kind !== "recorded") throw new Error(first.kind);
    expect(await recordSale(db.brian, input)).toEqual({ kind: "recorded", saleId: first.saleId, replayed: true });
    expect(await recordSale(db.marco, { ...input, sellerId: id.brian })).toEqual({ kind: "conflict" });
    // Even with a seller who is not an admin: the recorded sale's details differ.
    expect(await recordSale(db.marco, { ...input, sellerId: id.kwame })).toEqual({ kind: "conflict" });
    // Parallel double submits make one sale.
    const parallel = sale(itemId, id.brian);
    const results = await Promise.all([db.marco, db.brian, db.marco].map((client) => recordSale(client, parallel)));
    expect(results.filter((r) => r.kind === "recorded" && !r.replayed)).toHaveLength(1);
    expect(await salesOf(itemId)).toHaveLength(2);
  });

  it("researchers and anonymous callers can't read sellers or seller totals", async () => {
    for (const client of [db.kwame, anonClient()]) {
      expect(await sqlState(client.rpc("business_sellers"))).toBe("42501");
      expect(await sqlState(client.rpc("admin_business_seller_totals", {}))).toBe("42501");
    }
    await expect(listSellers(db.kwame)).rejects.toThrow();
    await expect(listSellerTotals(db.kwame)).rejects.toThrow();
  });
});

describe("A7 per-seller totals", () => {
  it("revenue, cost, gross profit and vials per seller for the period and item, matching the report's totals", async () => {
    const itemId = await newItem(30, "10");
    await sold(itemId, id.marco, { soldOn: "2026-09-02", quantity: 3, unitPrice: "40" });
    await sold(itemId, id.marco, { soldOn: "2026-09-20", quantity: 2, unitPrice: "35.50" });
    await sold(itemId, id.brian, { soldOn: "2026-09-21", quantity: 4, unitPrice: "0" });
    await sold(itemId, id.brian, { soldOn: "2026-08-31", quantity: 1, unitPrice: "12.34" });

    const september = { from: "2026-09-01", to: "2026-09-30", stockItemId: itemId };
    const totals = await listSellerTotals(db.marco, september);
    expect(totals).toEqual(
      [
        { sellerId: id.brian, sellerName: people.brian.name, sellerEmail: people.brian.email, sales: 1, vials: 4, revenue: "0.00", cost: "40.00", grossProfit: "-40.00" },
        { sellerId: id.marco, sellerName: people.marco.name, sellerEmail: people.marco.email, sales: 2, vials: 5, revenue: "191.00", cost: "50.00", grossProfit: "141.00" },
      ].sort((a, b) => a.sellerName.localeCompare(b.sellerName, "en", { sensitivity: "base" })),
    );
    // Every page, one seller per page, gives the same rows.
    expect(await listSellerTotals(db.marco, september, { pageSize: 1 })).toEqual(totals);
    // The per-seller rows add up to the report's totals for the same view.
    const report = await listSales(db.marco, september);
    expect(report.totals).toMatchObject({ sales: 3, vials: 9, revenue: "191.00", cost: "90.00", grossProfit: "101.00" });
    // All time for the item includes August.
    const all = await listSellerTotals(db.marco, { stockItemId: itemId });
    expect(all.find((row) => row.sellerId === id.brian)).toMatchObject({ sales: 2, vials: 5, revenue: "12.34", cost: "50.00", grossProfit: "-37.66" });
  });

  it("uses the seller's current name", async () => {
    const itemId = await newItem();
    await sold(itemId, id.former);
    const renamed = `Renamed ${randomBytes(2).toString("hex")}`;
    await ok(serviceClient().from("profiles").update({ name: renamed }).eq("id", id.former), "rename");
    try {
      expect(await listSellerTotals(db.marco, { stockItemId: itemId })).toEqual([expect.objectContaining({ sellerId: id.former, sellerName: renamed })]);
      // The sale keeps the name it was made under.
      expect((await getStockItem(db.marco, itemId))!.sales[0].sellerName).toBe(people.former.name);
    } finally {
      await ok(serviceClient().from("profiles").update({ name: people.former.name }).eq("id", id.former), "restore");
    }
  });
});

describe("A7 per-seller totals: two admins who share a name", () => {
  it("are two rows, each with its own id and email (admins only)", async () => {
    const twin = `Sam Twin ${randomBytes(2).toString("hex")}`;
    const first = { email: uniqueEmail("sel-twin-a"), name: twin, role: "admin" as const };
    const second = { email: uniqueEmail("sel-twin-b"), name: twin, role: "admin" as const };
    const firstId = await ensureAccount(first);
    const secondId = await ensureAccount(second);
    const itemId = await newItem();
    await sold(itemId, firstId, { quantity: 2 });
    await sold(itemId, secondId, { quantity: 3 });
    const totals = await listSellerTotals(db.marco, { stockItemId: itemId });
    expect(totals).toHaveLength(2);
    expect(new Set(totals.map((row) => row.sellerName))).toEqual(new Set([twin]));
    const byId = new Map(totals.map((row) => [row.sellerId, row]));
    expect(byId.get(firstId)).toMatchObject({ sellerEmail: first.email, vials: 2 });
    expect(byId.get(secondId)).toMatchObject({ sellerEmail: second.email, vials: 3 });
    // A6 lists both, told apart the same way.
    const sellers = (await listSellers(db.marco)).filter((seller) => seller.name === twin);
    expect(sellers.map((seller) => seller.email).sort()).toEqual([first.email, second.email].sort());
  });
});

describe("A7 Outside buyers: every outside sale can be found and linked", () => {
  it("lists each outside name still to link with its sales, vials, revenue and latest date; search; every page", async () => {
    const itemId = await newItem(30, "10");
    const tag = randomBytes(3).toString("hex");
    const osei = `Finder Osei ${tag}`;
    const lee = `Finder Lee ${tag}`;
    await sold(itemId, id.marco, { soldOn: "2026-08-20", quantity: 2, unitPrice: "40", buyer: { type: "outside", name: osei } });
    await sold(itemId, id.brian, { soldOn: "2026-09-05", quantity: 1, unitPrice: "12.50", buyer: { type: "outside", name: osei } });
    await sold(itemId, id.marco, { soldOn: "2026-09-01", quantity: 4, unitPrice: "10", buyer: { type: "outside", name: lee } });
    await sold(itemId, id.marco, { buyer: { type: "account", profileId: id.other } });

    const found = await listOutsideBuyers(db.marco, tag);
    expect(found).toEqual([
      { name: lee, sales: 1, vials: 4, revenue: "40.00", lastSold: "2026-09-01" },
      { name: osei, sales: 2, vials: 3, revenue: "92.50", lastSold: "2026-09-05" },
    ]);
    // Contains, ignoring case; % and _ are plain text, not wildcards.
    expect((await listOutsideBuyers(db.marco, ` OSEI ${tag.toUpperCase()} `)).map((row) => row.name)).toEqual([osei]);
    expect(await listOutsideBuyers(db.marco, `%${tag}`)).toEqual([]);
    expect(await listOutsideBuyers(db.marco, `Finder_Lee`)).toEqual([]);
    // One name per page gives the same rows; with no search, every name is listed.
    expect(await listOutsideBuyers(db.marco, tag, { pageSize: 1 })).toEqual(found);
    expect((await listOutsideBuyers(db.marco)).map((row) => row.name)).toEqual(expect.arrayContaining([osei, lee]));

    // A name's sales: exactly that name, newest first, every page.
    const sales = await listOutsideSales(db.marco, osei, { pageSize: 1 });
    expect(sales.map((row) => [row.soldOn, row.buyerName, row.buyerType])).toEqual([
      ["2026-09-05", osei, "outside"],
      ["2026-08-20", osei, "outside"],
    ]);
    expect(await listOutsideSales(db.marco, osei.toUpperCase())).toEqual([]);

    // Linked: the name leaves the list, and its sales are no longer outside sales.
    expect(await linkSale(db.marco, { saleId: sales[1].id, profileId: id.kwame, sameName: true })).toEqual({ kind: "linked", count: 2 });
    expect((await listOutsideBuyers(db.marco, tag)).map((row) => row.name)).toEqual([lee]);
    expect(await listOutsideSales(db.marco, osei)).toEqual([]);
  });

  it("is admin-only", async () => {
    for (const client of [db.kwame, anonClient()]) {
      expect(await sqlState(client.rpc("admin_business_outside_buyers", {}))).toBe("42501");
    }
    await expect(listOutsideBuyers(db.kwame)).rejects.toThrow();
    // RLS: a researcher reads no business sale.
    expect(await listOutsideSales(db.kwame, "Walk-in")).toEqual([]);
  });
});

/** Everything about a sale except the link fields, which must never change. */
async function frozen(saleId: string) {
  const row = await ok(
    serviceClient()
      .from("business_sales")
      .select(
        "stock_item_id, sold_on, quantity, unit_price::text, revenue::text, cost::text, gross_profit::text, currency, idempotency_key, recorded_by, recorded_at, seller_id, seller_name, business_sale_allocations(purchase_id, quantity, unit_cost::text, received_on)",
      )
      .eq("id", saleId)
      .single(),
    "sale",
  );
  return row;
}

describe("linking an outside buyer's sale to an account", () => {
  it("only outside → account, by an admin; nothing but the buyer changes; the original name and who linked are kept", async () => {
    const itemId = await newItem();
    const input = sale(itemId, id.brian, { quantity: 3, buyer: { type: "outside", name: "K. Osei" } });
    const first = await recordSale(db.marco, input);
    if (first.kind !== "recorded") throw new Error(first.kind);
    const saleId = first.saleId;
    const accountSale = await sold(itemId, id.marco, { buyer: { type: "account", profileId: id.other } });
    const before = await frozen(saleId);
    const totalsBefore = await ok(db.marco.rpc("admin_business_sales_totals", { p_stock_item_id: itemId }), "totals");

    // Researchers (even the account being linked) and anonymous callers are refused.
    for (const client of [db.kwame, anonClient()]) {
      expect(await sqlState(client.rpc("link_business_sale", { p_sale_id: saleId, p_buyer_profile_id: id.kwame }))).toBe("42501");
    }
    expect(await linkSale(db.kwame, { saleId, profileId: id.kwame, sameName: false })).toEqual({ kind: "not_authorized" });
    // Unknown sale, an account sale, an unknown account.
    expect(await linkSale(db.marco, { saleId: randomUUID(), profileId: id.kwame, sameName: false })).toEqual({ kind: "not_linkable" });
    expect(await linkSale(db.marco, { saleId: accountSale, profileId: id.kwame, sameName: false })).toEqual({ kind: "not_linkable" });
    expect(await linkSale(db.marco, { saleId, profileId: randomUUID(), sameName: false })).toEqual({ kind: "unknown_buyer" });

    expect(await linkSale(db.brian, { saleId, profileId: id.kwame, sameName: false })).toEqual({ kind: "linked", count: 1 });
    const linked = await ok(
      serviceClient()
        .from("business_sales")
        .select("buyer_type, buyer_profile_id, buyer_name, original_buyer_name, linked_by, linked_at")
        .eq("id", saleId)
        .single(),
      "linked",
    );
    expect(linked).toMatchObject({
      buyer_type: "account",
      buyer_profile_id: id.kwame,
      buyer_name: people.kwame.name,
      original_buyer_name: "K. Osei",
      linked_by: id.brian,
      linked_at: expect.any(String),
    });
    // Revenue, cost, allocations, date, quantity, price and seller are exactly as recorded.
    expect(await frozen(saleId)).toEqual(before);
    expect(await ok(db.marco.rpc("admin_business_sales_totals", { p_stock_item_id: itemId }), "totals")).toEqual(totalsBefore);
    expect(await getSale(db.marco, saleId)).toMatchObject({ buyerType: "account", buyerName: people.kwame.name, originalBuyerName: "K. Osei" });

    // Again to the same account: nothing to do. To another account, or back: refused.
    expect(await linkSale(db.marco, { saleId, profileId: id.kwame, sameName: false })).toEqual({ kind: "linked", count: 0 });
    expect(await linkSale(db.marco, { saleId, profileId: id.other, sameName: false })).toEqual({ kind: "not_linkable" });
    // The original submission, retried, still replays (it was an outside sale named K. Osei).
    expect(await recordSale(db.marco, input)).toEqual({ kind: "recorded", saleId, replayed: true });
    expect(await recordSale(db.marco, { ...input, buyer: { type: "account", profileId: id.kwame } })).toEqual({ kind: "conflict" });

    // No direct change through the API, for an admin or the secret key.
    for (const client of [db.marco, serviceClient() as unknown as Client]) {
      expect(await sqlState(client.from("business_sales").update({ buyer_name: "X" }).eq("id", saleId))).toBe("42501");
      expect(await sqlState(client.from("business_sales").update({ linked_by: null }).eq("id", saleId))).toBe("42501");
    }
  });

  it("two admins linking the same sale together: one links it, the other is refused; it is linked once", async () => {
    const itemId = await newItem();
    const saleId = await sold(itemId, id.marco, { buyer: { type: "outside", name: `Race ${randomBytes(2).toString("hex")}` } });
    const results = await Promise.all([
      linkSale(db.marco, { saleId, profileId: id.kwame, sameName: false }),
      linkSale(db.brian, { saleId, profileId: id.other, sameName: false }),
    ]);
    const winner = results.findIndex((result) => result.kind === "linked");
    expect(results[winner]).toEqual({ kind: "linked", count: 1 });
    expect(results[1 - winner]).toEqual({ kind: "not_linkable" });
    const row = await ok(serviceClient().from("business_sales").select("buyer_profile_id, linked_by").eq("id", saleId).single(), "row");
    expect(row).toEqual(winner === 0 ? { buyer_profile_id: id.kwame, linked_by: id.marco } : { buyer_profile_id: id.other, linked_by: id.brian });
  });

  it("can link every outside sale with the same buyer name at once, and only those", async () => {
    const itemId = await newItem();
    const name = `B. Name ${randomBytes(3).toString("hex")}`;
    const same = [
      await sold(itemId, id.marco, { buyer: { type: "outside", name } }),
      await sold(itemId, id.brian, { soldOn: "2026-09-01", buyer: { type: "outside", name } }),
      await sold(itemId, id.marco, { soldOn: "2026-08-20", buyer: { type: "outside", name } }),
    ];
    const different = [
      await sold(itemId, id.marco, { buyer: { type: "outside", name: `${name} Jr` } }),
      await sold(itemId, id.marco, { buyer: { type: "outside", name: name.toUpperCase() } }),
    ];
    expect(await linkSale(db.marco, { saleId: same[1], profileId: id.other, sameName: true })).toEqual({ kind: "linked", count: 3 });
    const rows = await ok(serviceClient().from("business_sales").select("id, buyer_type, buyer_profile_id").eq("stock_item_id", itemId), "rows");
    for (const saleId of same) expect(rows.find((r) => r.id === saleId)).toMatchObject({ buyer_type: "account", buyer_profile_id: id.other });
    for (const saleId of different) expect(rows.find((r) => r.id === saleId)).toMatchObject({ buyer_type: "outside", buyer_profile_id: null });
  });

  it("grants no access to the account's history and adds nothing to its supplies", async () => {
    const itemId = await newItem();
    const saleId = await sold(itemId, id.marco, { quantity: 2, buyer: { type: "outside", name: "Kwame" } });
    const service = serviceClient();
    const state = async () => ({
      shares: await ok(service.from("support_shares").select("*").eq("researcher_id", id.kwame), "shares"),
      vials: await ok(service.from("personal_vials").select("*").eq("owner_id", id.kwame), "vials"),
      settings: await ok(service.from("personal_supply_settings").select("*").eq("owner_id", id.kwame), "settings"),
      deductions: await ok(service.from("personal_vial_deductions").select("*").eq("owner_id", id.kwame), "deductions"),
      readable: await ok(db.marco.rpc("can_read_researcher", { p_owner: id.kwame }), "can read"),
    });
    const before = await state();
    expect(before.readable).toBe(false);
    expect(await linkSale(db.marco, { saleId, profileId: id.kwame, sameName: false })).toEqual({ kind: "linked", count: 1 });
    expect(await state()).toEqual(before);
    // The admin still reads nothing of Kwame's; Kwame still reads no business record, not even this sale.
    expect(await ok(db.marco.from("personal_vials").select("id").eq("owner_id", id.kwame), "admin reads")).toEqual([]);
    expect(await ok(db.kwame.from("business_sales").select("id"), "kwame reads")).toEqual([]);
  });
});
