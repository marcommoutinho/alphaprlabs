// V5 Business (20260928150000_business_overview.sql) through the API, against
// the real local Supabase: an item's low-stock threshold is set by admins
// only, through set_business_stock_threshold (idempotent by request key,
// every call audited), and A3 / D4's server action; the Business reads refuse
// researchers and signed-out callers. Exact totals over seeded data are in
// business-overview-owner.test.ts. Every test uses its own stock item.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listStockLevels, setStockThreshold } from "@/lib/business/service";
import { attemptFor, settles, type ThresholdAttempt } from "@/lib/business/stock";
import { businessToday } from "@/lib/inventory/screens";
import { recordPurchase } from "@/lib/inventory/service";
import { anonClient, answerLostClient, ensureAccount, ok, sqlState, signedInClient, uniqueEmail } from "../support/local-supabase";

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
    const first = { requestKey: key, stockItemId: itemId, expected: 10, threshold: 4 };
    expect(await setStockThreshold(db, first)).toEqual({ kind: "saved", threshold: 4, replayed: false });
    const after = await levelOf(itemId);
    expect(after).toMatchObject({ threshold: 4, thresholdChangedBy: admin.name });
    expect(Date.parse(after.thresholdChangedAt!)).toBeGreaterThan(Date.now() - 60_000);

    // A retry of the same entry replays and changes nothing, even after a later change.
    expect(await setStockThreshold(db, first)).toEqual({ kind: "saved", threshold: 4, replayed: true });
    const later = randomUUID();
    expect(await setStockThreshold(db, { requestKey: later, stockItemId: itemId, expected: 4, threshold: 25 })).toMatchObject({
      kind: "saved",
      replayed: false,
    });
    expect(await setStockThreshold(db, first)).toMatchObject({ kind: "saved", replayed: true });
    expect((await levelOf(itemId)).threshold).toBe(25);

    // The same key for other details (value, item or expected level) is refused.
    expect(await setStockThreshold(db, { ...first, threshold: 5 })).toEqual({ kind: "conflict" });
    expect(await setStockThreshold(db, { ...first, stockItemId: await newItem(1) })).toEqual({ kind: "conflict" });
    expect(await setStockThreshold(db, { ...first, expected: 25 })).toEqual({ kind: "conflict" });

    // Setting the value it already has is audited too (previous = new).
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 25, threshold: 25 })).toMatchObject({
      kind: "saved",
    });
    expect(await changesOf(itemId)).toEqual([
      { previous_threshold: 10, threshold: 4, request_key: key, changed_by: adminId },
      { previous_threshold: 4, threshold: 25, request_key: later, changed_by: adminId },
      { previous_threshold: 25, threshold: 25, request_key: expect.any(String), changed_by: adminId },
    ]);
  });

  it("is a compare-and-set: a stale expected level is refused (AP036), changes nothing and writes no audit row", async () => {
    const itemId = await newItem();
    const db = await signedInClient(admin.email);
    // Owen sets 8 over the 10 both saw.
    expect(
      await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold: 8 }),
    ).toMatchObject({ kind: "saved", replayed: false });
    // Priya still saw 10: refused, whatever she asks for.
    for (const threshold of [5, 10, 8]) {
      expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold })).toEqual({ kind: "changed" });
    }
    expect(
      await sqlState(
        db.rpc("set_business_stock_threshold", { p_request_key: randomUUID(), p_stock_item_id: itemId, p_expected: 10, p_threshold: 5 }),
      ),
    ).toBe("AP036");
    expect((await levelOf(itemId)).threshold).toBe(8);
    expect(await changesOf(itemId)).toEqual([{ previous_threshold: 10, threshold: 8, request_key: expect.any(String), changed_by: otherId }]);
    // Over the level she now sees, it saves.
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 8, threshold: 5 })).toMatchObject({
      kind: "saved",
      threshold: 5,
    });
  });

  it("an exact replay of a committed key returns its saved result first, though the level has changed since", async () => {
    const itemId = await newItem();
    const db = await signedInClient(admin.email);
    const entry = { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold: 5 };
    expect(await setStockThreshold(db, entry)).toEqual({ kind: "saved", threshold: 5, replayed: false });
    expect(
      await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 5, threshold: 8 }),
    ).toMatchObject({ kind: "saved" });
    // 10 is no longer the level, but this key was saved over it: a replay, not a refusal.
    expect(await setStockThreshold(db, entry)).toEqual({ kind: "saved", threshold: 5, replayed: true });
    // The same details under a new key are a new edit over a level that's gone: refused.
    expect(await setStockThreshold(db, { ...entry, requestKey: randomUUID() })).toEqual({ kind: "changed" });
    expect((await levelOf(itemId)).threshold).toBe(8);
    expect((await changesOf(itemId)).map((row) => row.threshold)).toEqual([5, 8]);
  });

  it("refuses a missing or out-of-range value or expected level (22023) and an unknown item (AP002)", async () => {
    const itemId = await newItem();
    const db = await signedInClient(admin.email);
    const call = (fields: { p_request_key?: string; p_stock_item_id?: string; p_expected?: number; p_threshold?: number }) =>
      sqlState(
        db.rpc("set_business_stock_threshold", {
          p_request_key: randomUUID(),
          p_stock_item_id: itemId,
          p_expected: 10,
          p_threshold: 5,
          ...fields,
        } as never),
      );
    expect(await call({ p_threshold: -1 })).toBe("22023");
    expect(await call({ p_threshold: 100001 })).toBe("22023");
    expect(await call({ p_threshold: null } as never)).toBe("22023");
    expect(await call({ p_expected: null } as never)).toBe("22023");
    expect(await call({ p_expected: -1 })).toBe("22023");
    expect(await call({ p_expected: 100001 })).toBe("22023");
    expect(await call({ p_request_key: null } as never)).toBe("22023");
    expect(await call({ p_stock_item_id: null } as never)).toBe("22023");
    expect(await call({ p_stock_item_id: randomUUID() })).toBe("AP002");
    expect(await call({ p_threshold: 0 })).toBe("ok");
    expect(await call({ p_expected: 0, p_threshold: 100000 })).toBe("ok");
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: randomUUID(), expected: 10, threshold: 3 })).toEqual({
      kind: "unknown_item",
    });
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 100000, threshold: -3 })).toEqual({
      kind: "invalid",
    });
    // Refused calls leave no audit row.
    expect((await changesOf(itemId)).map((row) => row.threshold)).toEqual([0, 100000]);
  });

  it("a researcher or a signed-out caller can't set it, read its history or change the item directly", async () => {
    const itemId = await newItem();
    const db = await signedInClient(researcher.email);
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold: 2 })).toEqual({
      kind: "not_authorized",
    });
    expect(
      await sqlState(
        anonClient().rpc("set_business_stock_threshold", {
          p_request_key: randomUUID(),
          p_stock_item_id: itemId,
          p_expected: 10,
          p_threshold: 2,
        }),
      ),
    ).toBe("42501");
    await setStockThreshold(await signedInClient(admin.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold: 7 });
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
    const entry = { requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: " 12 " };
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
    const entry = { requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: "5" };
    // Saved, but (in the browser) its answer was lost.
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 5, replayed: false });
    // Another admin sets 8 meanwhile.
    expect(
      await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 5, threshold: 8 }),
    ).toMatchObject({ kind: "saved", replayed: false });
    // Retry sends the same entry (the same request key): a replay, nothing changes.
    expect(await setStockThresholdAction(entry)).toEqual({ saved: true, threshold: 5, replayed: true });
    expect((await levelOf(itemId)).threshold).toBe(8);
    expect(await changesOf(itemId)).toEqual([
      { previous_threshold: 10, threshold: 5, request_key: entry.requestKey, changed_by: adminId },
      { previous_threshold: 5, threshold: 8, request_key: expect.any(String), changed_by: otherId },
    ]);
  });

  it.each(["dropped", "gateway"] as const)(
    "a save that committed but whose answer was lost (%s) is unsure: its retry replays and leaves another admin's newer value",
    async (how) => {
      const itemId = await newItem();
      let lost = true;
      acting.client = await answerLostClient(admin.email, (url) =>
        lost && url.includes("/rpc/set_business_stock_threshold") ? how : null,
      );
      const entry = { requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: "5" };
      // Postgres committed it; the answer never arrived.
      const first = await setStockThresholdAction(entry);
      expect(first).toEqual({ error: expect.stringContaining("Couldn't save"), unsure: true });
      expect((await levelOf(itemId)).threshold).toBe(5);
      // The sheet keeps the attempt, so Retry (or Save with 5 again) sends the same key.
      expect(settles(first)).toBe(false);
      const kept: ThresholdAttempt = { key: entry.requestKey, value: 5, expected: 10 };
      const retry = attemptFor(settles(first) ? null : kept, 5, 10, randomUUID);
      expect(retry).toBe(kept);
      // Another admin sets 8 meanwhile.
      expect(
        await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 5, threshold: 8 }),
      ).toMatchObject({ kind: "saved", replayed: false });
      // The retry gets through: a replay, and their 8 stays.
      lost = false;
      expect(
        await setStockThresholdAction({
          requestKey: retry.key,
          stockItemId: itemId,
          expected: String(retry.expected),
          threshold: String(retry.value),
        }),
      ).toEqual({ saved: true, threshold: 5, replayed: true });
      expect((await levelOf(itemId)).threshold).toBe(8);
      expect(await changesOf(itemId)).toEqual([
        { previous_threshold: 10, threshold: 5, request_key: entry.requestKey, changed_by: adminId },
        { previous_threshold: 5, threshold: 8, request_key: expect.any(String), changed_by: otherId },
      ]);
    },
  );

  it("an unsure save, then another admin's change, then a new Save from a stale sheet: refused with who set what, nothing saved", async () => {
    const itemId = await newItem();
    let lost = true;
    acting.client = await answerLostClient(admin.email, (url) => (lost && url.includes("/rpc/set_business_stock_threshold") ? "dropped" : null));
    // 5 over the 10 shown: committed, the answer lost.
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: "5" })).toMatchObject({
      unsure: true,
    });
    // Owen sets 8 meanwhile.
    expect(
      await setStockThreshold(await signedInClient(other.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 5, threshold: 8 }),
    ).toMatchObject({ kind: "saved" });
    // Reopened from the list as it last read (10), saved at once with a new key: refused.
    lost = false;
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: "10" })).toEqual({
      error: `Changed by ${other.name} to 8. Nothing was saved.`,
      changed: { threshold: 8 },
    });
    expect(acting.refreshed).toBe(1);
    expect(acting.revalidated).toEqual(["/admin/inventory", "/admin/business"]);
    expect((await levelOf(itemId)).threshold).toBe(8);
    expect((await changesOf(itemId)).map((row) => [row.threshold, row.changed_by])).toEqual([
      [5, adminId],
      [8, otherId],
    ]);
    // The sheet now compares against 8: a new decision saves.
    expect(await setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, expected: "8", threshold: "10" })).toMatchObject({
      saved: true,
      threshold: 10,
    });
  });

  it("the service reports a lost answer as unsure, and only the database's refusals as refusals", async () => {
    const itemId = await newItem();
    const lossy = await answerLostClient(admin.email, (url) => (url.includes("/rpc/") ? "dropped" : null));
    expect(await setStockThreshold(lossy, { requestKey: randomUUID(), stockItemId: itemId, expected: 10, threshold: 6 })).toEqual({
      kind: "unsure",
    });
    const db = await signedInClient(admin.email);
    const key = randomUUID();
    // The lost call committed 6.
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, expected: 6, threshold: 7 })).toMatchObject({ kind: "saved" });
    // Refused, nothing written: the sheet may start a new edit.
    expect(await setStockThreshold(db, { requestKey: key, stockItemId: itemId, expected: 6, threshold: 9 })).toEqual({ kind: "conflict" });
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: itemId, expected: 6, threshold: 9 })).toEqual({ kind: "changed" });
    expect(await setStockThreshold(db, { requestKey: randomUUID(), stockItemId: randomUUID(), expected: 7, threshold: 9 })).toEqual({
      kind: "unknown_item",
    });
    expect(
      await setStockThreshold(await signedInClient(researcher.email), { requestKey: randomUUID(), stockItemId: itemId, expected: 7, threshold: 9 }),
    ).toEqual({ kind: "not_authorized" });
    expect((await levelOf(itemId)).threshold).toBe(7);
  });

  it("returns the message for an invalid value or request, and refreshes when the item is gone", async () => {
    const itemId = await newItem();
    const entry = { requestKey: randomUUID(), stockItemId: itemId, expected: "10" };
    expect(await setStockThresholdAction({ ...entry, threshold: "2.5" })).toEqual({
      error: "Enter a whole number of vials, 0 or more.",
    });
    expect(await setStockThresholdAction({ ...entry, threshold: "100001" })).toEqual({
      error: "The threshold can be at most 100,000 vials.",
    });
    expect(await setStockThresholdAction({ ...entry, requestKey: "nope", threshold: "3" })).toEqual({
      error: expect.stringContaining("Couldn't save"),
    });
    expect(await setStockThresholdAction({ ...entry, expected: "ten", threshold: "3" })).toEqual({
      error: expect.stringContaining("Couldn't save"),
    });
    expect(await setStockThresholdAction(null)).toEqual({ error: expect.stringContaining("Couldn't save") });
    expect(await setStockThresholdAction({ ...entry, stockItemId: randomUUID(), threshold: "3" })).toEqual({
      error: "This stock item no longer exists. The list has been refreshed.",
    });
    expect(acting.refreshed).toBe(1);
    expect(acting.revalidated).toEqual([]);
    expect(await changesOf(itemId)).toEqual([]);
  });

  it("sends a researcher to sign in and changes nothing", async () => {
    const itemId = await newItem();
    acting.client = await signedInClient(researcher.email);
    await expect(
      setStockThresholdAction({ requestKey: randomUUID(), stockItemId: itemId, expected: "10", threshold: "1" }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect((await levelOf(itemId)).threshold).toBe(10);
    expect(await changesOf(itemId)).toEqual([]);
  });
});
