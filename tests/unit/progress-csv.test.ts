// D3 "Export CSV", pure: RFC 4180 quoting, the formula guard (CSV
// injection), the byte-order mark and CRLF endings, the rows oldest first,
// the file name and the range the route accepts.
import { describe, expect, it } from "vitest";
import { checkInsCsv, CSV_HEADER, csvField, csvFilename, csvText, EXPORT_EARLIEST, EXPORT_LATEST, exportRange } from "@/lib/progress/csv";
import type { CheckIn } from "@/lib/progress/service";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const checkIn = (day: string, overrides: Partial<CheckIn> = {}): CheckIn => ({
  id: uuid(Number(day.slice(8))),
  day,
  feeling: 4,
  effects: ["None"],
  effectsOther: "",
  note: "",
  measurement: null,
  version: 1,
  createdAt: `${day}T12:00:00Z`,
  updatedAt: `${day}T12:00:00Z`,
  ...overrides,
});

describe("CSV fields", () => {
  it("quotes a field only when it holds a comma, a double quote, a CR or an LF, doubling quotes", () => {
    expect(csvField("plain text")).toBe("plain text");
    expect(csvField("")).toBe("");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('said "fine"')).toBe('"said ""fine"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("cr\rhere")).toBe('"cr\rhere"');
    expect(csvField("µg · ç")).toBe("µg · ç");
  });

  it("prefixes free text that starts like a formula with an apostrophe, so a spreadsheet never runs it", () => {
    for (const formula of ["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "\tTab", "\rCR"]) {
      expect(csvText(formula).replace(/^"/, "").startsWith("'"), JSON.stringify(formula)).toBe(true);
    }
    expect(csvText("=1+2")).toBe("'=1+2");
    // Still quoted when it must be.
    expect(csvText('=A1,"x"')).toBe('"\'=A1,""x"""');
    expect(csvText("Felt fine = good")).toBe("Felt fine = good");
    expect(csvText("")).toBe("");
  });
});

describe("the check-ins file", () => {
  it("has a BOM, the header, one row per check-in oldest first, and CRLF endings", () => {
    const csv = checkInsCsv([
      checkIn("2026-09-24", {
        feeling: 2,
        effects: ["Headache", "Other"],
        effectsOther: "dizzy, briefly",
        note: 'Slept 5h; "rough" night\nwoke at 3',
        measurement: { name: "Weight", value: "81.40", unit: "kg", measuredAt: "2026-09-24T12:00:00Z" },
      }),
      checkIn("2026-09-20", { feeling: 5, note: "=cmd|' /C calc'!A0" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toEqual([
      CSV_HEADER.join(","),
      "2026-09-20,5,Great,,,,,'=cmd|' /C calc'!A0",
      '2026-09-24,2,Low,"Headache; Other: dizzy, briefly",Weight,81.4,kg,"Slept 5h; ""rough"" night\nwoke at 3"',
      "",
    ]);
    expect(CSV_HEADER).toEqual(["Date", "Feeling", "Feeling (word)", "Unwanted effects", "Measurement", "Value", "Unit", "Note"]);
  });

  it("is just the header with no check-ins", () => {
    expect(checkInsCsv([])).toBe(`﻿${CSV_HEADER.join(",")}\r\n`);
  });

  it("guards a measurement name or unit that starts like a formula, and keeps the value exact", () => {
    const csv = checkInsCsv([checkIn("2026-09-20", { measurement: { name: "@waist", value: "0.000001", unit: "-cm", measuredAt: "2026-09-20T12:00:00Z" } })]);
    expect(csv.split("\r\n")[1]).toBe("2026-09-20,4,Good,,'@waist,0.000001,'-cm,");
  });

  it("names the file after the range", () => {
    expect(csvFilename("2026-08-30", "2026-09-28")).toBe("alpha-check-ins_2026-08-30_to_2026-09-28.csv");
  });
});

describe("the export range", () => {
  it("accepts real dates in order: any range the screen can show, however long a cycle runs", () => {
    expect(exportRange("2026-08-30", "2026-09-28")).toEqual({ from: "2026-08-30", to: "2026-09-28" });
    expect(exportRange("2026-09-28", "2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    // A ten-year cycle's range with its week before (3,667 days), and far longer ones.
    expect(exportRange("2016-09-24", "2026-09-28")).toEqual({ from: "2016-09-24", to: "2026-09-28" });
    expect([EXPORT_EARLIEST, EXPORT_LATEST]).toEqual(["1999-12-25", "2100-12-31"]);
    expect(exportRange("1999-12-25", "2100-12-31")).not.toBeNull();
    expect(exportRange("1999-12-24", "2026-09-28")).toBeNull();
    expect(exportRange("2026-09-28", "2101-01-01")).toBeNull();
  });

  it("refuses a missing, malformed, impossible or reversed range", () => {
    for (const [from, to] of [
      [null, "2026-09-28"],
      ["2026-09-01", null],
      ["2026-9-1", "2026-09-28"],
      ["2026-02-30", "2026-03-01"],
      ["2026-09-28", "2026-09-27"],
      ["2026-09-01'--", "2026-09-28"],
    ] as const) {
      expect(exportRange(from, to), `${from}–${to}`).toBeNull();
    }
  });
});
