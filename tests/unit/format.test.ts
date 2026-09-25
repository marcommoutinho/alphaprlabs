import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDateTime, formatDay } from "@/lib/format";

describe("formatCurrency", () => {
  it("formats CAD with en-CA grouping and two decimals", () => {
    expect(formatCurrency(1234)).toBe("CAD 1,234.00");
    expect(formatCurrency(20)).toBe("CAD 20.00");
    expect(formatCurrency(0)).toBe("CAD 0.00");
    expect(formatCurrency(1234567.891)).toBe("CAD 1,234,567.89");
  });

  it("formats decimal strings exactly (database numeric values)", () => {
    expect(formatCurrency("480")).toBe("CAD 480.00");
    expect(formatCurrency("0.125")).toBe("CAD 0.13");
    expect(formatCurrency("12345678901234567.10")).toBe("CAD 12,345,678,901,234,567.10");
  });

  it("keeps the sign on negative amounts (e.g. a gross loss) but never shows -0.00", () => {
    expect(formatCurrency(-230.5)).toBe("CAD -230.50");
    expect(formatCurrency(-0.001)).toBe("CAD 0.00");
    expect(formatCurrency(-0)).toBe("CAD 0.00");
  });

  it("renders a dash for missing or invalid amounts", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
    expect(formatCurrency(Number.NaN)).toBe("—");
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatCurrency("12,00")).toBe("—");
  });
});

describe("date formatting", () => {
  const tz = { timeZone: "America/Toronto" };

  it("formats calendar dates without a time-zone shift", () => {
    expect(formatDay("2026-09-11")).toBe("Fri Sep 11");
    expect(formatDate("2026-09-11")).toBe("Sep 11, 2026");
    expect(formatDate("2028-02-29")).toBe("Feb 29, 2028");
  });

  it("formats instants in the given time zone on a 24-hour clock", () => {
    // 11:30 UTC is 07:30 in Toronto (EDT).
    expect(formatDateTime("2026-09-11T11:30:00Z", tz)).toBe("Fri Sep 11 · 07:30");
    expect(formatDateTime(new Date("2026-09-11T17:05:00Z"), tz)).toBe("Fri Sep 11 · 13:05");
  });

  it("uses 00, not 24, at midnight and rolls the day across zones", () => {
    // 04:15 UTC on Sep 12 is 00:15 on Sep 12 in Toronto; 03:59 UTC is still Sep 11.
    expect(formatDateTime("2026-09-12T04:15:00Z", tz)).toBe("Sat Sep 12 · 00:15");
    expect(formatDay("2026-09-12T03:59:00Z", tz)).toBe("Fri Sep 11");
    expect(formatDate("2027-01-01T04:59:00Z", tz)).toBe("Dec 31, 2026");
  });

  it("rejects impossible or unparseable dates", () => {
    expect(() => formatDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatDay("not a date")).toThrow(RangeError);
    expect(() => formatDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});
