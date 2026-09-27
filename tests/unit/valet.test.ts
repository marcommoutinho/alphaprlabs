// The Bank of Canada Valet answer's strict validation (src/lib/inventory/valet.mjs),
// shared by the save-time lookup, the daily sync route and the backfill script.
// Tests never call the real API.
import { describe, expect, it, vi } from "vitest";
import {
  calendarDay,
  fetchValetRange,
  fetchValetRates,
  pastWeekdays,
  valetChunks,
  validateValetRange,
  valetRangeUrl,
} from "@/lib/inventory/valet.mjs";

const TODAY = "2026-09-27";
const obs = (d: unknown, v: unknown) => ({ d, FXUSDCAD: { v } });
const check = (observations: unknown, start = "2026-08-17", end = "2026-08-28") => validateValetRange({ observations }, start, end, TODAY);

describe("validating a Valet answer for a range", () => {
  it("keeps every rate exactly as published", () => {
    expect(check([obs("2026-08-21", "1.3760"), obs("2026-08-26", "1.3876")])).toEqual({
      ok: true,
      rates: [
        { rate: "1.3760", rateDate: "2026-08-21" },
        { rate: "1.3876", rateDate: "2026-08-26" },
      ],
    });
    // Other keys beside the observations (terms, seriesDetail) are the real API's and fine.
    expect(validateValetRange({ terms: {}, seriesDetail: {}, observations: [obs("2026-08-17", "1.3865")] }, "2026-08-17", "2026-08-17", TODAY)).toMatchObject({ ok: true });
  });

  it("a malformed shape fails", () => {
    for (const body of [null, "text", 42, [], {}, { observations: {} }, { observations: "[]" }]) {
      expect(validateValetRange(body, "2026-08-17", "2026-08-28", TODAY)).toMatchObject({ ok: false });
    }
    for (const observation of [null, "2026-08-21", [], { d: "2026-08-21" }, { d: "2026-08-21", FXUSDCAD: "1.3760" }, { d: "2026-08-21", FXUSDCAD: {} }, { FXUSDCAD: { v: "1.3760" } }]) {
      expect(check([obs("2026-08-26", "1.3876"), observation]), JSON.stringify(observation)).toMatchObject({ ok: false });
    }
  });

  it("a date outside the range asked for, a bad date or a repeated date fails (nothing is filtered out)", () => {
    expect(check([obs("2026-08-26", "1.3876"), obs("2026-08-29", "1.3888")])).toEqual({
      ok: false,
      error: "observation 2 (2026-08-29) is outside 2026-08-17..2026-08-28",
    });
    expect(check([obs("2026-08-16", "1.3876")])).toMatchObject({ ok: false });
    for (const d of ["2026-02-30", "2026-8-21", "21/08/2026", "", 20260821, null]) {
      expect(check([obs(d, "1.3760")]), String(d)).toMatchObject({ ok: false, error: "observation 1 has no valid date" });
    }
    expect(check([obs("2026-08-21", "1.3760"), obs("2026-08-21", "1.3760")])).toEqual({ ok: false, error: "2026-08-21 appears more than once" });
  });

  it("a bad rate fails", () => {
    for (const v of ["abc", "1,3876", "-1.38", "0", "0.0000", "1.3876543", "138.76", "", " 1.38", 1.3876, null]) {
      expect(check([obs("2026-08-21", "1.3760"), obs("2026-08-26", v)]), String(v)).toEqual({ ok: false, error: "2026-08-26 has no valid rate" });
    }
  });

  it("an empty answer fails for a range with business days already published", () => {
    expect(check([])).toMatchObject({ ok: false, error: expect.stringContaining("no rates for 2026-08-17..2026-08-28") });
    expect(validateValetRange({ observations: [] }, "2025-01-01", "2026-01-01", TODAY)).toMatchObject({ ok: false });
    // No rate can exist yet: a weekend, today and the days after, before the series began, Christmas.
    expect(validateValetRange({ observations: [] }, "2026-08-29", "2026-08-30", TODAY)).toEqual({ ok: true, rates: [] });
    expect(validateValetRange({ observations: [] }, "2026-09-22", "2026-09-28", "2026-09-26")).toMatchObject({ ok: false });
    expect(validateValetRange({ observations: [] }, "2026-09-24", "2026-09-28", "2026-09-26")).toEqual({ ok: true, rates: [] }); // 2 weekdays past
    expect(validateValetRange({ observations: [] }, "2016-01-01", "2017-01-02", TODAY)).toEqual({ ok: true, rates: [] });
    expect(validateValetRange({ observations: [] }, "2025-12-25", "2025-12-28", TODAY)).toEqual({ ok: true, rates: [] });
  });

  it("the helpers: real dates, past weekdays, chunks", () => {
    expect(calendarDay("2028-02-29")).toBe("2028-02-29");
    expect(calendarDay("2027-02-29")).toBeNull();
    expect(pastWeekdays("2026-08-17", "2026-08-28", TODAY)).toBe(10);
    expect(pastWeekdays("2026-09-21", "2026-09-30", "2026-09-24")).toBe(3);
    expect(pastWeekdays("2016-12-26", "2017-01-06", TODAY)).toBe(4); // from Jan 3, 2017
    expect(valetChunks("2025-01-01", "2026-09-27")).toEqual([
      { start: "2025-01-01", end: "2026-01-01" },
      { start: "2026-01-02", end: "2026-09-27" },
    ]);
    expect(valetChunks("2026-09-27", "2026-09-27")).toEqual([{ start: "2026-09-27", end: "2026-09-27" }]);
  });
});

describe("fetching ranges", () => {
  const answer = (body: unknown, status = 200) => vi.fn<typeof globalThis.fetch>(async () => Response.json(body, { status }));

  it("one no-store request with a timeout; an error status, a network failure or a non-JSON answer fails", async () => {
    const fetch = answer({ observations: [obs("2026-08-26", "1.3876")] });
    expect(await fetchValetRange("2026-08-26", "2026-08-26", { fetch, timeoutMs: 1000, today: TODAY })).toMatchObject({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe(valetRangeUrl("2026-08-26", "2026-08-26"));
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
    expect(await fetchValetRange("2026-08-26", "2026-08-26", { fetch: answer({}, 503), timeoutMs: 1000, today: TODAY })).toEqual({ ok: false, error: "HTTP 503" });
    const offline = vi.fn<typeof globalThis.fetch>(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await fetchValetRange("2026-08-26", "2026-08-26", { fetch: offline, timeoutMs: 1000, today: TODAY })).toEqual({ ok: false, error: "fetch failed" });
    const html = vi.fn<typeof globalThis.fetch>(async () => new Response("<html>maintenance</html>"));
    expect(await fetchValetRange("2026-08-26", "2026-08-26", { fetch: html, timeoutMs: 1000, today: TODAY })).toMatchObject({ ok: false });
  });

  it("several chunks fail as a whole, naming the chunk; no request starts past the deadline", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ observations: [obs("2025-01-02", "1.4400")] }))
      .mockResolvedValueOnce(Response.json({ observations: [obs("2027-01-04", "1.3500")] }));
    expect(await fetchValetRates("2025-01-01", "2026-09-27", { fetch, timeoutMs: 1000, today: TODAY })).toEqual({
      ok: false,
      error: "Bank of Canada 2026-01-02..2026-09-27: observation 1 (2027-01-04) is outside 2026-01-02..2026-09-27",
    });
    const never = answer({ observations: [] });
    expect(await fetchValetRates("2026-08-17", "2026-08-28", { fetch: never, timeoutMs: 1000, today: TODAY, deadline: Date.now() - 1 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("out of time"),
    });
    expect(never).not.toHaveBeenCalled();
  });
});
