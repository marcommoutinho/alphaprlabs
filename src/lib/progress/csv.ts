// D3 "Export CSV": a researcher's own check-ins for the range shown, as a
// spreadsheet opens it. Pure.
//
// RFC 4180: fields separated by commas, records by CRLF; a field holding a
// comma, a double quote, a CR or an LF is wrapped in double quotes, with each
// double quote doubled. A UTF-8 byte-order mark goes first so spreadsheet
// apps read accents and "µ" correctly. Free text (effects, notes, units)
// that starts like a formula (=, +, -, @, tab, CR) is prefixed with an
// apostrophe, so opening the file never runs it (CSV injection).
import { formatAmount, parseDecimal } from "@/lib/calculator/decimal";
import { FEELING_WORDS } from "./rules";
import { reportedEffects } from "./screen";
import type { CheckIn } from "./service";

export const CSV_TYPE = "text/csv; charset=utf-8";
export const CSV_HEADER = ["Date", "Feeling", "Feeling (word)", "Unwanted effects", "Measurement", "Value", "Unit", "Note"] as const;

const BOM = "﻿";
const FORMULA = /^[=+\-@\t\r]/;

/** One field as written: quoted when it must be. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Free text, made safe to open in a spreadsheet (see the header). */
export const csvText = (value: string) => csvField(FORMULA.test(value) ? `'${value}` : value);

/** The rows, oldest day first, with the header; CRLF line endings, BOM first. */
export function checkInsCsv(checkIns: readonly CheckIn[]): string {
  const lines = [CSV_HEADER.map(csvField).join(",")];
  for (const c of [...checkIns].sort((a, b) => a.day.localeCompare(b.day))) {
    const value = c.measurement ? parseDecimal(c.measurement.value) : null;
    lines.push(
      [
        csvField(c.day),
        csvField(String(c.feeling)),
        csvField(FEELING_WORDS[c.feeling] ?? ""),
        csvText(reportedEffects(c).join("; ")),
        csvText(c.measurement?.name ?? ""),
        csvField(value ? formatAmount(value) : (c.measurement?.value ?? "")),
        csvText(c.measurement?.unit ?? ""),
        csvText(c.note),
      ].join(","),
    );
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** "alpha-check-ins_2026-08-30_to_2026-09-28.csv" */
export const csvFilename = (from: string, to: string) => `alpha-check-ins_${from}_to_${to}.csv`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (value: string | null): value is string =>
  value !== null && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The longest range one export covers (a little over a year). */
export const EXPORT_MAX_DAYS = 400;

/** `?from=&to=` as a range of days, or null when it isn't one (missing, not a date, reversed, too long). */
export function exportRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!realDate(from) || !realDate(to) || from > to) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return days < EXPORT_MAX_DAYS ? { from, to } : null;
}
