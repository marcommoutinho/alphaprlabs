// V5 Business (20260928150000_business_overview.sql) through the API, against
// the real local Supabase: an item's low-stock threshold is set by admins
// only, through set_business_stock_threshold (idempotent by request key,
// every call audited), and A3 / D4's server action; the Business reads refuse
// researchers and signed-out callers. Exact totals over seeded data are in
// business-overview-owner.test.ts. Every test uses its own stock item.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listStockLevels, setStockThreshold } from "@/lib/business/service";
import { businessToday } from "@/lib/inventory/screens";
import { recordPurchase } from "@/lib/inventory/service";
import { anonClient, ensureAccount, ok, sqlState, signedInClient, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown, refreshed: 0, revalidated: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({
  refresh: () => void acting.refreshed++,
  revalidatePath: (path: string) => void acting.revalidated.push(path),
}));

const { setStockThresholdAction } = await import("@/app/(private)/admin/inventory/actions");

const admin = { email: uniqueEmail("v5-admin"), name: "Priya Sandhu" };
const researcher = { email: uniqueEmail("v5-researcher"), name: "V5 Researcher" };
const other = { email: uniqueEmail("v5-other-admin"), name: "Owen Marchetti" };
let adminId: string;
let otherId: string;

beforeAll(async () => {
  adminId = await ensureAccount({ ...admin, role: "admin" });
  otherId = await ensureAccount({ ...other, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
});

beforeEach(async () => {
  acting.client = await signedInClient(admin.email);
  acting.refreshed = 0;
  acting.revalidated = [];
});

/** A new stock item with `quantity` vials at CAD 4.00, received yesterday or earlier. */
async function newItem(quantity = 6): Promise<string> {
  const db = await signedInClient(admin.email);
  const name = `Compound V5 ${randomBytes(4).toString("hex")}`;
  const peptideId = await ok(
    db.rpc("save_library_peptide", {
      p_name: name,
      p_information: `[Supplied information for ${name}]`,
      p_cycling_off_guidance: "",
      p_supplement_guidance: "",
      p_available: true,
    }),
  );
  const bought = await recordPurchase(db, {
    idempotencyKey: randomUUID(),
    stockItemId: null,
    peptideId,
    strengthMg: "10",
    receivedOn: "2026-08-01",
    quantity,
    unitCost: "4.00",
  });
  if (bought.kind !== "recorded") throw new Error(bought.kind);
  return bought.stockItemId;
}

const levelOf = async (itemId: string) =>
  (await listStockLevels(await signedInClient(admin.email), businessToday())).find((level) => level.id === itemId)!;
const changesOf = async (itemId: string) =>
  ok(
    (await signedInClient(admin.email))
      .from("business_stock_threshold_changes")
      .select("previous_threshold, threshold, request_key, changed_by")
      .eq("stock_item_id", itemId)
      .order("changed_at"),
  );

describe("set_business_stock_threshold", () => {
  it("an admin sets it; the same request again replays; every call is audited with who and the previous value", async () => {
    const itemId = await newItem(6);
    const db = await signedInClient(admin.email);
    const before = await levelOf(itemId);
    expect(before).toMatchObject({ onHand: 6, valueAtCost: "24.00", threshold: 10, thresholdChangedAt: null, thresholdChangedBy: null });

    const key = randomUUID();
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, threshold: 4 })).toEqual({
      kind: "saved",
      threshold: 4,
      replayed: false,
    });
    const after = await levelOf(itemId);
    expect(after).toMatchObject({ threshold: 4, thresholdChangedBy: admin.name });
    expect(Date.parse(after.thresholdChangedAt!)).toBeGreaterThan(Date.now() - 60_000);

    // A retry of the same entry replays and changes nothing, even after a later change.
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, threshold: 4 })).toEqual({
      kind: "saved",
      threshold: 4,
      replayed: true,
    });
    const later = randomUUID();
    expect(await setStockThreshold(db, { requestKey: later, stockItemId: itemId, threshold: 25 })).toMatchObject({ kind: "saved", replayed: false });
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, threshold: 4 })).toMatchObject({ kind: "saved", replayed: true });
    expect((await levelOf(itemId)).threshold).toBe(25);

    // The same key for other details is refused.
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, threshold: 5 })).toEqual({ kind: "conflict" });
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: await newItem(1), threshold: 4 })).toEqual({ kind: "conflict" });

    // Setting the value it already has is audited too (previous = new).
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, threshold: 25 })).toMatchObject({ kind: "saved" });
    expect(await changesOf(itemId)).toEqual([
      { previous_threshold: 10, threshold: 4, request_key: key, changed_by: adminId },
      { previous_threshold: 4, threshold: 25, request_key: later, changed_by: adminId },
      { previous_threshold: 25, threshold: 25, request_key: expect.any(String), changed_by: adminId },
    ]);
  });

  it("refuses a missing or out-of-range value (22023) and an unknown item (AP002)", async () => {
    const itemId = await newItem();
    const db = await signedInClient(admin.email);
    const call = (fields: { p_request_key?: string; p_stock_item_id?: string; p_threshold?: number }) =>
      sqlState(
        db.rpc("set_business_stock_threshold", {
          p_request_key: randomUUID(),
          p_stock_item_id: itemId,
          p_threshold: 5,
          ...fields,
        } as never),
      );
    expect(await call({ p_threshold: -1 })).toBe("22023");
    expect(await call({ p_threshold: 100001 })).toBe("22023");
    expect(await call({ p_threshold: null } as never)).toBe("22023");
    expect(await call({ p_request_key: null } as never)).toBe("22023");
    expect(await call({ p_stock_item_id: null } as never)).toBe("22023");
    expect(await call({ p_stock_item_id: randomUUID() })).toBe("AP002");
    expect(await call({ p_threshold: 0 })).toBe("ok");
    expect(await call({ p_threshold: 100000 })).toBe("ok");
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: randomUUID(), threshold: 3 })).toEqual({ kind: "unknown_item" });
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, threshold: -3 })).toEqual({ kind: "invalid" });
    // Refused calls leave no audit row.
    expect((await changesOf(itemId)).map((row) => row.threshold)).toEqual([0, 100000]);
  });

  it("a researcher or a signed-out caller can't set it, read its history or change the item directly", async () => {
    const itemId = await newItem();
    const db = await signedInClient(researcher.email);
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, threshold: 2 })).toEqual({ kind: "not_authorized" });
    expect(
      await sqlState(anonClient().rpc("set_business_stock_threshold", { p_request_key: randomUUID(), p_stock_item_id: itemId, p_threshold: 2 })),
    ).toBe("42501");
    await setStockThreshold(await signedInClient(admin.email), { requestKey: randomUUID(), stockItemId: itemId, threshold: 7 });
    expect(await ok(db.from("business_stock_threshold_changes").select("id").eq("stock_item_id", itemId))).toEqual([]);
    expect(await sqlState(anonClient().from("business_stock_threshold_changes").select("id"))).toBe("42501");
    // No direct writes, even for an admin: the function is the only way in.
    for (const client of [db, await signedInClient(admin.email)]) {
      const update = await client.from("business_stock_items").update({ low_stock_threshold: 1 }).eq("id", itemId).select("id");
      expect(update.error?.code ?? (update.data?.length === 0 ? "no rows" : "updated")).not.toBe("updated");
      expect(
        await sqlState(
          client
            .from("business_stock_threshold_changes")
            .insert({ stock_item_id: itemId, previous_threshold: 1, threshold: 2, request_key: randomUUID(), changed_by: adminId }),
        ),
      ).toBe("42501");
    }
    expect((await levelOf(itemId)).threshold).toBe(7);
  });
});

describe("the Business reads are for admins only", () => {
  const today = "2026-09-24";
  const reads = {
    admin_business_stock_levels: { p_today: today },
    admin_business_sales_by_day: { p_from: "2026-09-01", p_to: today },
    admin_business_sales_summary: { p_from: "2026-09-01", p_to: today },
    admin_business_months: { p_from: "2025-09-01", p_to: today },
    admin_business_purchase_suppliers: { p_from: "2025-10-01", p_to: today },
  } as const;

  it("refuse researchers (42501) and signed-out callers", async () => {
    const db = await signedInClient(researcher.email);
    for (const [name, args] of Object.entries(reads)) {
      expect(await sqlState(db.rpc(name as keyof typeof reads, args as never)), name).toBe("42501");
      expect(await sqlState(anonClient().rpc(name as keyof typeof reads, args as never)), name).toBe("42501");
    }
  });

  it("answer an admin, and refuse a missing, reversed or too long range (22023)", async () => {
    const db = await signedInClient(admin.email);
    for (const [name, args] of Object.entries(reads)) {
      expect(await sqlState(db.rpc(name as keyof typeof reads, args as never)), name).toBe("ok");
    }
    expect(await sqlState(db.rpc("admin_business_sales_by_day", { p_from: today, p_to: "2026-09-01" }))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_sales_by_day", { p_from: "2025-08-20", p_to: today }))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_sales_by_day", { p_from: "2025-08-21", p_to: today }))).toBe("ok");
    expect(await sqlState(db.rpc("admin_business_months", { p_from: "2023-09-01", p_to: today }))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_months", { p_from: "2023-10-31", p_to: today }))).toBe("ok");
    expect(await sqlState(db.rpc("admin_business_sales_summary", { p_from: null, p_to: today } as never))).toBe("22023");
    expect(await sqlState(db.rpc("admin_business_purchase_suppliers", { p_from: today, p_to: "2026-01-01" }))).toBe("22023");
    // Days without sales are rows of zeros.
    const days = await ok(db.rpc("admin_business_sales_by_day", { p_from: "1999-12-30", p_to: "2000-01-02" }).order("day"));
    expect(days).toEqual(
      ["1999-12-30", "1999-12-31", "2000-01-01", "2000-01-02"].map((day) => ({
        day,
        sales: 0,
        vials: 0,
        revenue: "0.00",
        cost: "0.00",
        gross_profit: "0.00",
      })),
    );
  });
});

describe("A3 / D4 setStockThresholdAction", () => {
  it("saves the typed value and refreshes Stock and Business; a retry of the same entry replays", async () => {
    const itemId = await newItem();
    const entry = { requestKey: randomUUID(), stockItemId: itemId, threshold: " 12 " };
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 12, replayed: false });
    expect(acting.revalidated).toEqual(["/admin/inventory", "/admin/business"]);
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 12, replayed: true });
    expect((await changesOf(itemId)).map((row) => row.threshold)).toEqual([12]);
    expect(await setStockThresholdAction({ ...entry, threshold: "13" })).toEqual({
      error: expect.stringContaining("already"),
    });
    expect((await levelOf(itemId)).threshold).toBe(12);
  });

  it("a retry of a saved entry after another admin's change replays and leaves their newer value", async () => {
    const itemId = await newItem();
    const entry = { requestKey: randomUUID(), stockItemId: itemId, threshold: "5" };
    // Saved, but (in the browser) its answer was lost.
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 5, replayed: false });
    // Another admin sets 8 meanwhile.
    expect(
      await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, threshold: 8 }),
    ).toMatchObject({ kind: "saved", replayed: false });
    // Retry sends the same entry (the same request key): a replay, nothing changes.
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 5, replayed: true });
    expect((await levelOf(itemId)).threshold).toBe(8);
    expect(await changesOf(itemId)).toEqual([
      { previous_threshold: 10, threshold: 5, request_key: entry.requestKey, changed_by: adminId },
      { previous_threshold: 5, threshold: 8, request_key: expect.any(String), changed_by: otherId },
    ]);
  });

  it("returns the message for an invalid value or request, and refreshes when the item is gone", async () => {
    const itemId = await newItem();
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, threshold: "2.5" })).toEqual({
      error: "Enter a whole number of vials, 0 or more.",
    });
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, threshold: "100001" })).toEqual({
      error: "The threshold can be at most 100,000 vials.",
    });
    expect(await setStockThresholdAction({ requestKey: "nope", stockItemId: itemId, threshold: "3" })).toEqual({
      error: expect.stringContaining("Couldn't save"),
    });
    expect(await setStockThresholdAction(null)).toEqual({ error: expect.stringContaining("Couldn't save") });
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: randomUUID(), threshold: "3" })).toEqual({
      error: "This stock item no longer exists. The list has been refreshed.",
    });
    expect(acting.refreshed).toBe(1);
    expect(acting.revalidated).toEqual([]);
    expect(await changesOf(itemId)).toEqual([]);
  });

  it("sends a researcher to sign in and changes nothing", async () => {
    const itemId = await newItem();
    acting.client = await signedInClient(researcher.email);
    await expect(setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, threshold: "1" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect((await levelOf(itemId)).threshold).toBe(10);
    expect(await changesOf(itemId)).toEqual([]);
  });
});
