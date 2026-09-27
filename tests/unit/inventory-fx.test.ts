// USD purchases (Marco, 2026-09-27): choosing the Bank of Canada rate, the
// lookup from our stored rates with the Valet fallback (an in-memory table
// and a mocked fetch: tests never call the real API), the sync, the Valet
// answer's parsing, the local test stub's gate, exact conversion and parsing,
// and the copy.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StockItemView } from "@/components/admin/inventory-views";
import {
  addDays,
  fxTestFetch,
  parseObservations,
  pickRate,
  syncFxRates,
  usdCadRate,
  valetRangeUrl,
  valetUrl,
  type FxRate,
  type FxStore,
} from "@/lib/inventory/fx";
import {
  AMOUNT_TOO_LARGE,
  convertUsdPurchase,
  COST_INVALID,
  CURRENCY_REQUIRED,
  PURCHASE_ALREADY_RECORDED,
  USD_AMOUNT_CENTS,
  USD_AMOUNT_TOO_LARGE,
  USD_COST_INVALID,
  usdAmount,
  usdToCad,
  validatePurchase,
  type UsdPurchaseEntry,
} from "@/lib/inventory/rules";
import {
  fxEarlierNote,
  fxRateLine,
  purchaseAlreadyRecordedToast,
  purchaseRecordedToast,
  usdConversionLine,
  usdPreview,
} from "@/lib/inventory/screens";
import type { StockItemDetail } from "@/lib/inventory/service";

const KEY = "0b5b3a3e-6f0e-4c8e-9a51-1f9d7f3b2c10";
const ITEM = "7a51958a-1a5e-4f22-8f55-689ba8ce0a1b";

/** Real published rates (Valet FXUSDCAD, Aug-Sep 2026): no Aug 29-30 (weekend) or Sep 5-7 (weekend, Labour Day). */
const RATES: Record<string, string> = {
  "2026-08-17": "1.3865",
  "2026-08-21": "1.3760",
  "2026-08-24": "1.3842",
  "2026-08-25": "1.3839",
  "2026-08-26": "1.3876",
  "2026-08-28": "1.3888",
  "2026-09-04": "1.3840",
  "2026-09-08": "1.3851",
  "2026-09-25": "1.4145",
};
const observations = (rates: Record<string, string>) => Object.entries(rates).map(([d, v]) => ({ d, FXUSDCAD: { v } }));
const published = parseObservations({ observations: observations(RATES) })!;

/** public.fx_rates in memory: the latest in a range, and store_fx_rates' first-value-wins rule. */
function memoryStore(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: FxStore = {
    latest: vi.fn(async (start: string, end: string) => {
      const dates = [...rows.keys()].filter((date) => date >= start && date <= end).sort();
      const date = dates.at(-1);
      return date ? { rate: rows.get(date)!, rateDate: date } : null;
    }),
    save: vi.fn(async (rates: FxRate[]) => {
      const summary = { stored: 0, unchanged: 0, invalid: 0, conflicts: [] as string[] };
      for (const { rate, rateDate } of rates) {
        const current = rows.get(rateDate);
        if (current === undefined) {
          rows.set(rateDate, rate);
          summary.stored++;
        } else if (current === rate) summary.unchanged++;
        else summary.conflicts.push(rateDate);
      }
      return summary;
    }),
  };
  return { store, rows };
}

describe("choosing the rate for a date received", () => {
  it("uses the date's own rate on a business day", () => {
    expect(pickRate(published, "2026-08-26")).toEqual({ rate: "1.3876", rateDate: "2026-08-26" });
  });

  it("a weekend uses the Friday before; a holiday Monday the last business day", () => {
    expect(pickRate(published, "2026-08-29")).toEqual({ rate: "1.3888", rateDate: "2026-08-28" });
    expect(pickRate(published, "2026-08-30")).toEqual({ rate: "1.3888", rateDate: "2026-08-28" });
    expect(pickRate(published, "2026-09-07")).toEqual({ rate: "1.3840", rateDate: "2026-09-04" });
  });

  it("today before the day's rate is published uses the latest earlier rate", () => {
    // Aug 27 is a business day whose rate isn't in the data yet.
    expect(pickRate(published, "2026-08-27")).toEqual({ rate: "1.3876", rateDate: "2026-08-26" });
  });

  it("never a later rate, nor one older than the 10-day window", () => {
    expect(pickRate(published, "2026-08-22")).toEqual({ rate: "1.3760", rateDate: "2026-08-21" });
    // Sep 18's window starts on Sep 8 (10 days before); Sep 19's on Sep 9, after the last rate.
    expect(pickRate(published, "2026-09-18")).toEqual({ rate: "1.3851", rateDate: "2026-09-08" });
    expect(pickRate(published, "2026-09-19")).toBeNull();
    expect(pickRate(published, "2026-09-24")).toBeNull();
    expect(pickRate([], "2026-08-26")).toBeNull();
  });

  it("the window is the 10 days before the date through the date", () => {
    expect(valetUrl("2026-08-26")).toBe(
      "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2026-08-16&end_date=2026-08-26",
    );
    expect(valetUrl("2026-03-05")).toContain("start_date=2026-02-23&end_date=2026-03-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("the Valet answer", () => {
  it("keeps each rate exactly as published and skips observations without one", () => {
    expect(parseObservations({ observations: [{ d: "2026-08-21", FXUSDCAD: { v: "1.3760" } }, { d: "2026-08-22" }] })).toEqual([
      { rate: "1.3760", rateDate: "2026-08-21" },
    ]);
    expect(parseObservations({ observations: [] })).toEqual([]);
  });

  it("anything else is not an answer", () => {
    for (const body of [null, "text", {}, { observations: {} }]) expect(parseObservations(body)).toBeNull();
    for (const v of ["abc", "1,3876", "-1.38", "0", "0.0000", "1.3876543", "138.76", 1.3876]) {
      expect(parseObservations({ observations: [{ d: "2026-08-26", FXUSDCAD: { v } }] })).toBeNull();
    }
    expect(parseObservations({ observations: [{ d: "2026-02-30", FXUSDCAD: { v: "1.38" } }] })).toBeNull();
  });
});

describe("the rate lookup: our stored rates first, the Valet API only for a missing window", () => {
  const answer = (rates: Record<string, string>) => vi.fn(async () => Response.json({ observations: observations(rates) }));
  const quiet = () => [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];

  it("selects from the table: the date's own rate, else the latest stored within 10 days; Valet isn't asked", async () => {
    const { store } = memoryStore(RATES);
    const fetch = answer({});
    expect(await usdCadRate("2026-08-26", { store, fetch })).toEqual({ ok: true, rate: "1.3876", rateDate: "2026-08-26" });
    expect(await usdCadRate("2026-08-29", { store, fetch })).toEqual({ ok: true, rate: "1.3888", rateDate: "2026-08-28" });
    expect(await usdCadRate("2026-09-07", { store, fetch })).toEqual({ ok: true, rate: "1.3840", rateDate: "2026-09-04" });
    expect(await usdCadRate("2026-08-27", { store, fetch })).toEqual({ ok: true, rate: "1.3876", rateDate: "2026-08-26" });
    expect(store.latest).toHaveBeenCalledWith("2026-08-19", "2026-08-29");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an empty window asks Valet once (no-store), stores what it validated, then uses the stored rate", async () => {
    const { store, rows } = memoryStore();
    const fetch = answer({ "2026-08-24": "1.3842", "2026-08-25": "1.3839" });
    expect(await usdCadRate("2026-08-25", { store, fetch })).toEqual({ ok: true, rate: "1.3839", rateDate: "2026-08-25" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }];
    expect(url).toBe(valetUrl("2026-08-25"));
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(rows)).toEqual({ "2026-08-24": "1.3842", "2026-08-25": "1.3839" });
    // Now stored: the next lookup doesn't ask again.
    expect(await usdCadRate("2026-08-25", { store, fetch })).toMatchObject({ ok: true, rate: "1.3839" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a Valet value that differs from a stored one never replaces it: the stored rate is used and the conflict logged", async () => {
    const [warn, error] = quiet();
    // The table had no rate when first read, and a rate for the date was stored
    // meanwhile (e.g. by the daily sync); Valet now answers a different value.
    const conflict = memoryStore({ "2026-06-10": "1.3000" });
    vi.mocked(conflict.store.latest).mockResolvedValueOnce(null);
    expect(await usdCadRate("2026-06-10", { store: conflict.store, fetch: answer({ "2026-06-10": "1.3111" }) })).toEqual({
      ok: true,
      rate: "1.3000",
      rateDate: "2026-06-10",
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("different rates for 2026-06-10"));
    warn.mockRestore();
    error.mockRestore();
  });

  it("an error status, a network failure, a timeout or a malformed answer is 'unavailable' and stores nothing", async () => {
    const [warn, error] = quiet();
    const { store, rows } = memoryStore();
    const hangs = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const failures = [
      vi.fn(async () => new Response("down", { status: 503 })),
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      hangs as typeof fetch,
      vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 })),
      vi.fn(async () => Response.json({ observations: [{ d: "2026-08-26", FXUSDCAD: { v: "n/a" } }] })),
    ];
    for (const fetch of failures) {
      expect(await usdCadRate("2026-08-26", { store, fetch, timeoutMs: 20 })).toEqual({ ok: false, reason: "unavailable" });
    }
    expect(rows.size).toBe(0);
    expect(store.save).not.toHaveBeenCalled();
    // After an invalid 200, a later valid answer is stored and used.
    expect(await usdCadRate("2026-08-26", { store, fetch: answer({ "2026-08-26": "1.3876" }) })).toMatchObject({ ok: true, rate: "1.3876" });
    warn.mockRestore();
    error.mockRestore();
  });

  it("an unreadable table is 'unavailable' (Valet isn't asked); a window without any rate is 'no_rate'", async () => {
    const [warn, error] = quiet();
    const broken: FxStore = { latest: vi.fn(async () => Promise.reject(new Error("db down"))), save: vi.fn() };
    const fetch = answer(RATES);
    expect(await usdCadRate("2026-08-26", { store: broken, fetch })).toEqual({ ok: false, reason: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await usdCadRate("2026-08-26", { store: memoryStore().store, fetch: answer({}) })).toEqual({ ok: false, reason: "no_rate" });
    await expect(usdCadRate("2026-02-30", { store: memoryStore().store })).rejects.toThrow(RangeError);
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("the sync (daily cron and backfill)", () => {
  it("reads the last 14 days by default and stores them; again, nothing changes", async () => {
    const { store, rows } = memoryStore();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ observations: observations({ "2026-09-25": "1.4145", "2026-09-24": "1.4100" }) }));
    expect(await syncFxRates({ today: "2026-09-27", store, fetch })).toEqual({
      ok: true,
      from: "2026-09-13",
      to: "2026-09-27",
      fetched: 2,
      stored: 2,
      unchanged: 0,
      invalid: 0,
      conflicts: [],
    });
    expect(fetch.mock.calls[0][0]).toBe(valetRangeUrl("2026-09-13", "2026-09-27"));
    expect(await syncFxRates({ today: "2026-09-27", store, fetch })).toMatchObject({ ok: true, stored: 0, unchanged: 2 });
    expect(rows.size).toBe(2);
  });

  it("backfills a long range a year at a time, and stores nothing unless every range was read", async () => {
    const { store, rows } = memoryStore();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ observations: observations({ "2025-01-02": "1.4400" }) }));
    expect(await syncFxRates({ from: "2025-01-01", today: "2026-09-27", store, fetch })).toMatchObject({ ok: true, fetched: 1, stored: 1 });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      valetRangeUrl("2025-01-01", "2026-01-01"),
      valetRangeUrl("2026-01-02", "2026-09-27"),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = vi.fn().mockResolvedValueOnce(Response.json({ observations: [] })).mockResolvedValueOnce(new Response("", { status: 500 }));
    const empty = memoryStore();
    expect(await syncFxRates({ from: "2025-01-01", today: "2026-09-27", store: empty.store, fetch: failing })).toMatchObject({ ok: false });
    expect(empty.store.save).not.toHaveBeenCalled();
    expect(await syncFxRates({ from: "1999-12-31", today: "2026-09-27", store, fetch })).toMatchObject({ ok: false, error: "invalid from date" });
    expect(await syncFxRates({ from: "2026-09-28", today: "2026-09-27", store, fetch })).toMatchObject({ ok: false });
    expect(rows.size).toBe(1);
    warn.mockRestore();
  });
});

describe("the local test stub (BOC_FX_TEST_RATES)", () => {
  const LOCAL = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
    BOC_FX_TEST_RATES: JSON.stringify({ run: "x", "2026-08-26": "1.3876", "2026-08-10": "unavailable", "2026-08-11": "invalid" }),
  };

  it("is off unless set, and serves a Valet answer against the local stack", async () => {
    expect(fxTestFetch({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" })).toBeNull();
    const stub = fxTestFetch(LOCAL) as typeof fetch;
    expect(typeof stub).toBe("function");
    expect(await (await stub(valetUrl("2026-08-29"))).json()).toEqual({ observations: [{ d: "2026-08-26", FXUSDCAD: { v: "1.3876" } }] });
    expect((await stub(valetUrl("2026-08-10"))).status).toBe(503);
    expect(await (await stub(valetUrl("2026-08-11"))).text()).toContain("maintenance");
    const { store } = memoryStore();
    expect(await usdCadRate("2026-08-28", { env: LOCAL, store })).toEqual({ ok: true, rate: "1.3876", rateDate: "2026-08-26" });
  });

  it("is refused on Vercel or against any other database, and then Valet is never asked", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(fxTestFetch({ ...LOCAL, VERCEL: "1" })).toBe("refused");
    expect(fxTestFetch({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" })).toBe("refused");
    expect(fxTestFetch({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "" })).toBe("refused");
    const real = vi.fn(async () => Response.json({ observations: observations(RATES) }));
    const env = { ...LOCAL, VERCEL: "1" };
    const { store, rows } = memoryStore();
    expect(await usdCadRate("2026-08-26", { env, fetch: real, store })).toEqual({ ok: false, reason: "unavailable" });
    expect(await syncFxRates({ env, fetch: real, store, today: "2026-09-27" })).toMatchObject({ ok: false });
    expect(real).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
    error.mockRestore();
  });
});

describe("USD amounts and conversion (exact decimals)", () => {
  it("parses a USD cost with the comma rules, 2 decimals and the limit", () => {
    expect(usdAmount("11")).toEqual({ ok: true, value: "11.00" });
    expect(usdAmount(" 11,5 ")).toEqual({ ok: true, value: "11.50" });
    expect(usdAmount("0")).toEqual({ ok: true, value: "0.00" });
    expect(usdAmount("1000000")).toEqual({ ok: true, value: "1000000.00" });
    for (const value of ["1,000", "12,500", "1.000,5", "-1", "abc", "", "1e3", ",5", "5.", 11]) {
      expect(usdAmount(value)).toEqual({ ok: false, error: USD_COST_INVALID });
    }
    expect(usdAmount("11.005")).toEqual({ ok: false, error: USD_AMOUNT_CENTS });
    expect(usdAmount("1000000.01")).toEqual({ ok: false, error: USD_AMOUNT_TOO_LARGE });
  });

  it("CAD per vial = round-half-up(USD × rate, 2)", () => {
    expect(usdToCad("11.00", "1.3876")).toBe("15.26"); // 15.2636
    expect(usdToCad("1.00", "1.385")).toBe("1.39"); // exactly half: up, not to even
    expect(usdToCad("1.00", "1.005")).toBe("1.01"); // binary floats give 1.00
    expect(usdToCad("0.00", "1.3876")).toBe("0.00");
    expect(usdToCad("999999.99", "1.4145")).toBe("1414499.99"); // 1414499.985855 → .99
  });

  it("the purchase form: CAD unchanged, USD validated for conversion", () => {
    const valid = { idempotencyKey: KEY, stockItemId: ITEM, receivedOn: "2026-08-26", quantity: "10", unitCost: "11,5" };
    expect(validatePurchase({ ...valid, currency: "USD" }, "2026-09-27")).toEqual({
      ok: true,
      value: { idempotencyKey: KEY, stockItemId: ITEM, peptideId: null, strengthMg: null, receivedOn: "2026-08-26", quantity: 10, currency: "USD", usdUnitCost: "11.50" },
    });
    // The CAD cost keeps its rules (a comma is not a decimal point there).
    expect(validatePurchase({ ...valid, currency: "CAD" }, "2026-09-27")).toEqual({ ok: false, error: COST_INVALID });
    expect(validatePurchase({ ...valid, unitCost: "20" }, "2026-09-27")).toMatchObject({ ok: true, value: { unitCost: "20.00" } });
    expect(validatePurchase({ ...valid, currency: "EUR" }, "2026-09-27")).toEqual({ ok: false, error: CURRENCY_REQUIRED });
    expect(validatePurchase({ ...valid, currency: "USD", unitCost: "1,000" }, "2026-09-27")).toEqual({ ok: false, error: USD_COST_INVALID });
  });

  it("converts with the server's rate and refuses a CAD cost above the limit", () => {
    const entry: UsdPurchaseEntry = {
      idempotencyKey: KEY,
      stockItemId: ITEM,
      peptideId: null,
      strengthMg: null,
      receivedOn: "2026-08-29",
      quantity: 10,
      currency: "USD",
      usdUnitCost: "11.00",
    };
    expect(convertUsdPurchase(entry, { rate: "1.3888", rateDate: "2026-08-28" })).toEqual({
      ok: true,
      value: {
        idempotencyKey: KEY,
        stockItemId: ITEM,
        peptideId: null,
        strengthMg: null,
        receivedOn: "2026-08-29",
        quantity: 10,
        unitCost: "15.28",
        usd: { usdUnitCost: "11.00", rate: "1.3888", rateDate: "2026-08-28" },
      },
    });
    expect(convertUsdPurchase({ ...entry, usdUnitCost: "1000000.00" }, { rate: "1.3876", rateDate: "2026-08-26" })).toEqual({
      ok: false,
      error: AMOUNT_TOO_LARGE,
    });
  });
});

describe("USD copy", () => {
  const fx = { rate: "1.3861", rateDate: "2026-09-25" };

  it("the rate line and why an earlier day's rate is used", () => {
    expect(fxRateLine(fx)).toBe("Bank of Canada rate for Sep 25: 1.3861");
    expect(fxEarlierNote(fx, "2026-09-25", "2026-09-27")).toBeNull();
    expect(fxEarlierNote(fx, "2026-09-26", "2026-09-26")).toMatch(/^Today's rate isn't published yet/);
    expect(fxEarlierNote(fx, "2026-09-27", "2026-09-28")).toBe(
      "No rate was published for Sep 27 (weekend or holiday), so the latest earlier rate is used.",
    );
  });

  it("the preview amounts, the purchase line and the toasts", () => {
    expect(usdPreview("10", "11", "1.3876")).toEqual({ unitCost: "15.26", total: "152.60" });
    expect(usdPreview("", "11,5", "1.3876")).toEqual({ unitCost: "15.96", total: null });
    expect(usdPreview("10", "1,000", "1.3876")).toEqual({ unitCost: null, total: null });
    const usd = { usdUnitCost: "11.00", rate: "1.3876", rateDate: "2026-08-26" };
    expect(usdConversionLine({ unitCost: "15.26", usd })).toBe("USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26");
    expect(purchaseRecordedToast(10, "15.26", "11.00")).toBe("Purchase recorded · 10 vials at USD 11.00 = CAD 15.26");
    expect(purchaseRecordedToast(10, "20.00")).toBe("Purchase recorded · 10 vials at CAD 20.00");
    expect(purchaseAlreadyRecordedToast({ unitCost: "15.26", usd })).toBe(
      `${PURCHASE_ALREADY_RECORDED} Recorded as USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26.`,
    );
    expect(purchaseAlreadyRecordedToast({ unitCost: "20.00", usd: null })).toBe(PURCHASE_ALREADY_RECORDED);
    expect(purchaseAlreadyRecordedToast(null)).toBe(PURCHASE_ALREADY_RECORDED);
  });

  it("A4 Stock item shows the conversion for a USD lot only", () => {
    const lot = { receivedOn: "2026-08-26", quantity: 10, totalCost: "152.60", allocated: 0, remaining: 10, recordedAt: "", recordedOrder: 1 };
    const detail: StockItemDetail = {
      item: { id: ITEM, peptideId: ITEM, peptideName: "Compound A", peptideAvailable: true, strengthMg: "8", label: "Compound A · 8 mg", purchased: 20, sold: 0, onHand: 20 },
      lots: [
        { ...lot, id: "a", unitCost: "15.26", usd: { usdUnitCost: "11.00", rate: "1.3876", rateDate: "2026-08-26" } },
        { ...lot, id: "b", unitCost: "20.00", totalCost: "200.00", recordedOrder: 2, usd: null },
      ],
      sales: [],
      salesTruncated: false,
    };
    const text = renderToStaticMarkup(createElement(StockItemView, { detail })).replace(/<[^>]+>/g, " ");
    expect(text).toContain("USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26");
    expect(text.match(/USD/g)).toHaveLength(1);
    expect(text).toContain("CAD 152.60");
  });
});
