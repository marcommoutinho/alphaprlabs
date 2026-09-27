// USD purchases (Marco, 2026-09-27): choosing the Bank of Canada rate, the
// Valet answer's parsing, the fetch (mocked: tests never call the real API),
// the local test stub's gate, exact conversion and parsing, and the copy.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StockItemView } from "@/components/admin/inventory-views";
import { addDays, fxTestFetch, parseObservations, pickRate, usdCadRate, valetUrl } from "@/lib/inventory/fx";
import {
  AMOUNT_TOO_LARGE,
  convertUsdPurchase,
  COST_INVALID,
  CURRENCY_REQUIRED,
  USD_AMOUNT_CENTS,
  USD_AMOUNT_TOO_LARGE,
  USD_COST_INVALID,
  usdAmount,
  usdToCad,
  validatePurchase,
  type UsdPurchaseEntry,
} from "@/lib/inventory/rules";
import { fxEarlierNote, fxRateLine, purchaseRecordedToast, usdConversionLine, usdPreview } from "@/lib/inventory/screens";
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

describe("fetching the rate (mocked)", () => {
  const TODAY = "2026-09-27";
  const answer = (rates: Record<string, string>) => vi.fn(async () => Response.json({ observations: observations(rates) }));
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

  it("asks the Valet API for the window and picks the rate; past windows are cached, recent ones are not", async () => {
    const fetch = answer(RATES);
    expect(await usdCadRate("2026-08-29", { fetch, today: TODAY })).toEqual({ ok: true, rate: "1.3888", rateDate: "2026-08-28" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe(valetUrl("2026-08-29"));
    expect(init.next?.revalidate).toBeGreaterThan(0);
    expect(init.cache).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);

    await usdCadRate("2026-09-26", { fetch, today: TODAY });
    const recent = fetch.mock.calls[1] as unknown as [string, RequestInit & { next?: unknown }];
    expect(recent[1].cache).toBe("no-store");
    expect(recent[1].next).toBeUndefined();
  });

  it("an error status, a network failure, a timeout or a malformed answer is 'unavailable' (never a fallback)", async () => {
    const warn = quiet();
    const status = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await usdCadRate("2026-08-26", { fetch: status, today: TODAY })).toEqual({ ok: false, reason: "unavailable" });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await usdCadRate("2026-08-26", { fetch: offline, today: TODAY })).toEqual({ ok: false, reason: "unavailable" });
    const hangs = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    expect(await usdCadRate("2026-08-26", { fetch: hangs as typeof fetch, today: TODAY, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    const html = vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 }));
    expect(await usdCadRate("2026-08-26", { fetch: html, today: TODAY })).toEqual({ ok: false, reason: "unavailable" });
    const odd = vi.fn(async () => Response.json({ observations: [{ d: "2026-08-26", FXUSDCAD: { v: "n/a" } }] }));
    expect(await usdCadRate("2026-08-26", { fetch: odd, today: TODAY })).toEqual({ ok: false, reason: "unavailable" });
    warn.mockRestore();
  });

  it("a window with no rate at all is 'no_rate'", async () => {
    expect(await usdCadRate("2026-08-26", { fetch: answer({}), today: TODAY })).toEqual({ ok: false, reason: "no_rate" });
  });

  it("refuses an invalid date outright", async () => {
    await expect(usdCadRate("2026-02-30", { fetch: answer(RATES), today: TODAY })).rejects.toThrow(RangeError);
  });
});

describe("the local test stub (BOC_FX_TEST_RATES)", () => {
  const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421", BOC_FX_TEST_RATES: JSON.stringify({ "2026-08-26": "1.3876", "2026-08-10": "unavailable" }) };

  it("is off unless set, and serves a Valet answer against the local stack", async () => {
    expect(fxTestFetch({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" })).toBeNull();
    const stub = fxTestFetch(LOCAL);
    expect(typeof stub).toBe("function");
    const body = await (await (stub as typeof fetch)(valetUrl("2026-08-29"))).json();
    expect(body).toEqual({ observations: [{ d: "2026-08-26", FXUSDCAD: { v: "1.3876" } }] });
    expect((await (stub as typeof fetch)(valetUrl("2026-08-10"))).status).toBe(503);
    expect(await usdCadRate("2026-08-28", { env: LOCAL, today: "2026-09-27" })).toEqual({ ok: true, rate: "1.3876", rateDate: "2026-08-26" });
  });

  it("is refused on Vercel or against any other database, and then no rate is given", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(fxTestFetch({ ...LOCAL, VERCEL: "1" })).toBe("refused");
    expect(fxTestFetch({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" })).toBe("refused");
    expect(fxTestFetch({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "" })).toBe("refused");
    const real = vi.fn(async () => Response.json({ observations: observations(RATES) }));
    const env = { ...LOCAL, VERCEL: "1" };
    expect(await usdCadRate("2026-08-26", { env, fetch: real, today: "2026-09-27" })).toEqual({ ok: false, reason: "unavailable" });
    expect(real).not.toHaveBeenCalled();
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

  it("the preview amounts, the purchase line and the toast", () => {
    expect(usdPreview("10", "11", "1.3876")).toEqual({ unitCost: "15.26", total: "152.60" });
    expect(usdPreview("", "11,5", "1.3876")).toEqual({ unitCost: "15.96", total: null });
    expect(usdPreview("10", "1,000", "1.3876")).toEqual({ unitCost: null, total: null });
    const usd = { usdUnitCost: "11.00", rate: "1.3876", rateDate: "2026-08-26" };
    expect(usdConversionLine({ unitCost: "15.26", usd })).toBe("USD 11.00 × 1.3876 (BoC Aug 26) = CAD 15.26");
    expect(purchaseRecordedToast(10, "15.26", "11.00")).toBe("Purchase recorded · 10 vials at USD 11.00 = CAD 15.26");
    expect(purchaseRecordedToast(10, "20.00")).toBe("Purchase recorded · 10 vials at CAD 20.00");
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
