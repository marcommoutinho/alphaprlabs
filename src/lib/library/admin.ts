// A8 / D6 Library (admin) and A9 / D6 Edit peptide, design v3: the list's
// state and meta lines, the editor's copy and its validation. Pure and
// client-safe; shared by the screens, the server action and the tests
// (tests/unit/library-admin.test.ts).
//
// An entry is a draft until it is first published (Marco, 2026-09-28: the
// library draft / publish state; 20260929110000_admin_content.sql). A draft
// is never visible to researchers and can't be added anywhere; publishing
// needs the research summary. A published entry never goes back to draft:
// "Offered for new cycles" off withdraws it ("Not offered"), and researchers
// whose cycles already use it keep it (Marco, 2026-09-26).
import { massLabel } from "@/lib/alpha/format";
import { Exact, normalizeDecimal, plain } from "@/lib/calculator/decimal";
import { formatMonthDay } from "@/lib/format";

/** Library dates are business dates (America/Toronto). */
export const LIBRARY_ADMIN_ZONE = "America/Toronto";

/** Mirrors the database checks on public.peptides. */
export const LIBRARY_LIMITS = { name: 120, short: 160, text: 4000, strengths: 12, strengthMg: "100000", strengthDecimals: 3 } as const;

// ── The entry as admin screens read it ──────────────────────────────────────

export type AdminPeptide = {
  id: string;
  name: string;
  shortDescription: string;
  /** mg, exact, ascending ("0.5", "10"). */
  strengths: string[];
  /** The research summary. */
  information: string;
  cyclingOff: string;
  supplement: string;
  /** "Offered for new cycles" as set (kept while a draft). */
  offered: boolean;
  /** When it was first published; null while it is a draft. */
  publishedAt: string | null;
  /** The compare-and-set token: the version the editor opened. */
  version: number;
  updatedAt: string;
  templateCount: number;
  cycleCount: number;
};

export type PeptideState = "offered" | "draft" | "not-offered";

export const peptideState = (entry: Pick<AdminPeptide, "publishedAt" | "offered">): PeptideState =>
  entry.publishedAt === null ? "draft" : entry.offered ? "offered" : "not-offered";

export const STATE_LABEL: Record<PeptideState, string> = { offered: "Offered", draft: "Draft", "not-offered": "Not offered" };

/** D6's line above the editor's title. */
export const STATE_LINE: Record<PeptideState, string> = {
  offered: "Offered · visible to researchers",
  draft: "Draft · not visible to researchers",
  "not-offered": "Not offered · hidden from new cycles",
};

const cycles = (n: number) => `${n} ${n === 1 ? "cycle" : "cycles"}`;
const updated = (at: string) => formatMonthDay(at, { timeZone: LIBRARY_ADMIN_ZONE });

/** A8's mono line: "Updated Aug 20 · in 4 cycles" (a count only, never whose cycles). */
export const rowMeta = (entry: Pick<AdminPeptide, "updatedAt" | "cycleCount">) => `Updated ${updated(entry.updatedAt)} · in ${cycles(entry.cycleCount)}`;

/** D6's shorter line: "Aug 20 · 4 cycles". */
export const rowMetaShort = (entry: Pick<AdminPeptide, "updatedAt" | "cycleCount">) => `${updated(entry.updatedAt)} · ${cycles(entry.cycleCount)}`;

/** "4 researcher cycles and 2 templates use it. Turning it off won't change them." */
export function usageNote(entry: Pick<AdminPeptide, "cycleCount" | "templateCount"> | null): string {
  const c = entry?.cycleCount ?? 0;
  const t = entry?.templateCount ?? 0;
  if (c === 0 && t === 0) return "No researcher cycle or template uses it yet.";
  const parts = [c ? `${c} researcher ${c === 1 ? "cycle" : "cycles"}` : null, t ? `${t} ${t === 1 ? "template" : "templates"}` : null].filter(Boolean);
  return `${parts.join(" and ")} ${c + t === 1 ? "uses" : "use"} it. Turning it off won't change them.`;
}

/** "20 peptides · 2 drafts" (A8 / D6 header), or "No peptides yet". */
export function libraryCount(entries: readonly Pick<AdminPeptide, "publishedAt">[]): string {
  if (!entries.length) return "No peptides yet";
  const drafts = entries.filter((entry) => entry.publishedAt === null).length;
  const base = `${entries.length} ${entries.length === 1 ? "peptide" : "peptides"}`;
  return drafts ? `${base} · ${drafts} ${drafts === 1 ? "draft" : "drafts"}` : base;
}

/** The list's search: name and short description, case-insensitive. */
export function matchesPeptide(entry: Pick<AdminPeptide, "name" | "shortDescription">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || entry.name.toLowerCase().includes(q) || entry.shortDescription.toLowerCase().includes(q);
}

export const byPeptideName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ── Vial strengths ──────────────────────────────────────────────────────────

/** A strength chip: "10 mg", "500 mcg" (under 1 mg in mcg, as every amount). */
export const strengthLabel = (mg: string) => massLabel(mg);

export const STRENGTH_INVALID = "Enter a strength above 0 mg, up to 100,000 mg (at most 3 decimals).";
export const STRENGTH_DUPLICATE = "That strength is already listed.";
export const STRENGTHS_FULL = `Up to ${LIBRARY_LIMITS.strengths} strengths.`;

/**
 * A typed strength in mg ("10", "2,5", "0.25") as exact canonical mg, or an
 * error. Thousands-looking text ("1,000") is refused, as every amount.
 */
export function parseStrength(text: string): { ok: true; mg: string } | { ok: false; error: string } {
  const normalized = normalizeDecimal(text);
  if (normalized === null) return { ok: false, error: STRENGTH_INVALID };
  const value = new Exact(normalized);
  if (value.lessThanOrEqualTo(0) || value.greaterThan(LIBRARY_LIMITS.strengthMg) || value.decimalPlaces() > LIBRARY_LIMITS.strengthDecimals) {
    return { ok: false, error: STRENGTH_INVALID };
  }
  return { ok: true, mg: plain(value) };
}

/** Adds a strength to a list: sorted ascending, refused when invalid, already there, or the list is full. */
export function addStrength(list: readonly string[], text: string): { ok: true; list: string[] } | { ok: false; error: string } {
  const parsed = parseStrength(text);
  if (!parsed.ok) return parsed;
  if (list.some((mg) => new Exact(mg).equals(parsed.mg))) return { ok: false, error: STRENGTH_DUPLICATE };
  if (list.length >= LIBRARY_LIMITS.strengths) return { ok: false, error: STRENGTHS_FULL };
  return { ok: true, list: [...list, parsed.mg].sort((a, b) => new Exact(a).comparedTo(b)) };
}

// ── The editor ──────────────────────────────────────────────────────────────

export type PeptideForm = {
  id: string | null;
  /** The version it was opened at (null: new). */
  version: number | null;
  name: string;
  shortDescription: string;
  strengths: string[];
  information: string;
  cyclingOff: string;
  supplement: string;
  offered: boolean;
};

export const newPeptideForm = (): PeptideForm => ({
  id: null,
  version: null,
  name: "",
  shortDescription: "",
  strengths: [],
  information: "",
  cyclingOff: "",
  supplement: "",
  // On, so Publish makes it visible (D6's mock shows a draft with it off;
  // either is kept while it is a draft and applied when it is published).
  offered: true,
});

export const formOfPeptide = (entry: AdminPeptide): PeptideForm => ({
  id: entry.id,
  version: entry.version,
  name: entry.name,
  shortDescription: entry.shortDescription,
  strengths: [...entry.strengths],
  information: entry.information,
  cyclingOff: entry.cyclingOff,
  supplement: entry.supplement,
  offered: entry.offered,
});

export const NAME_REQUIRED = "Name is required.";
export const NAME_TOO_LONG = `Names can be up to ${LIBRARY_LIMITS.name} characters.`;
/** Another entry has this name (case and surrounding spaces ignored); shown under the name. */
export const NAME_TAKEN = "A peptide with this name already exists.";
export const SHORT_TOO_LONG = `The short description can be up to ${LIBRARY_LIMITS.short} characters.`;
export const TEXT_TOO_LONG = "Each text can be up to 4,000 characters.";
/** D6: shown beside the research summary's label while it is empty. */
export const SUMMARY_REQUIRED = "Required to publish";
export const SUMMARY_REQUIRED_ERROR = "Add a research summary to publish.";
/** A non-null id that is not a uuid, or a malformed submission: never treated as new. */
export const INVALID_ENTRY = "This entry could not be identified. Reload the page and try again.";

export type PeptideField = "name" | "shortDescription" | "strengths" | "information" | "cyclingOff" | "supplement";
export type PeptideProblems = Partial<Record<PeptideField, string>>;

export type ValidPeptide = Omit<PeptideForm, "version"> & { version: number | null; publish: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// String.prototype.trim removes the same whitespace as the database's
// trim_whitespace(), so text accepted here is never refused as blank there.
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const chars = (value: string) => [...value].length;

/**
 * What stops a save (`publish` false: Save draft; true: Publish, or saving an
 * entry already published, which must keep its summary). Field by field;
 * empty when it can be saved.
 */
export function peptideProblems(form: Pick<PeptideForm, PeptideField>, publish: boolean): PeptideProblems {
  const found: PeptideProblems = {};
  const name = text(form.name);
  if (!name) found.name = NAME_REQUIRED;
  else if (chars(name) > LIBRARY_LIMITS.name) found.name = NAME_TOO_LONG;
  if (chars(text(form.shortDescription)) > LIBRARY_LIMITS.short) found.shortDescription = SHORT_TOO_LONG;
  if (form.strengths.length > LIBRARY_LIMITS.strengths) found.strengths = STRENGTHS_FULL;
  else if (form.strengths.some((mg) => !parseStrength(mg).ok)) found.strengths = STRENGTH_INVALID;
  else if (new Set(form.strengths.map((mg) => plain(new Exact(mg)))).size !== form.strengths.length) found.strengths = STRENGTH_DUPLICATE;
  const summary = text(form.information);
  if (chars(summary) > LIBRARY_LIMITS.text) found.information = TEXT_TOO_LONG;
  else if (publish && !summary) found.information = SUMMARY_REQUIRED_ERROR;
  if (chars(text(form.cyclingOff)) > LIBRARY_LIMITS.text) found.cyclingOff = TEXT_TOO_LONG;
  if (chars(text(form.supplement)) > LIBRARY_LIMITS.text) found.supplement = TEXT_TOO_LONG;
  return found;
}

/**
 * The server action's check of a submission: `{ ...form, publish }`, from
 * the submission alone. A malformed shape or id is refused as INVALID_ENTRY;
 * then the field rules (Publish needs a summary). Nothing here reads the
 * entry as it is now: whether it has since been published (and so needs its
 * summary) is the database's check, made after it has recognised a replay
 * of the same request key or a save over a newer version (AP038). Text is
 * trimmed, strengths canonical and ascending.
 */
export function validatePeptide(
  input: unknown,
): { ok: true; value: ValidPeptide } | { ok: false; error: string; problems: PeptideProblems } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const invalid = { ok: false as const, error: INVALID_ENTRY, problems: {} };
  if (raw.id != null && !(typeof raw.id === "string" && UUID.test(raw.id))) return invalid;
  const id = typeof raw.id === "string" ? raw.id.toLowerCase() : null;
  const version = raw.version;
  if (id !== null && !(typeof version === "number" && Number.isSafeInteger(version) && version >= 1)) return invalid;
  if (!Array.isArray(raw.strengths) || !raw.strengths.every((mg) => typeof mg === "string")) return invalid;
  if (typeof raw.offered !== "boolean" || typeof raw.publish !== "boolean") return invalid;
  const strengths: string[] = [];
  for (const mg of raw.strengths as string[]) {
    const parsed = parseStrength(mg);
    if (!parsed.ok) return { ok: false, error: STRENGTH_INVALID, problems: { strengths: STRENGTH_INVALID } };
    strengths.push(parsed.mg);
  }
  const form = {
    name: text(raw.name),
    shortDescription: text(raw.shortDescription),
    strengths: strengths.sort((a, b) => new Exact(a).comparedTo(b)),
    information: text(raw.information),
    cyclingOff: text(raw.cyclingOff),
    supplement: text(raw.supplement),
  };
  const problems = peptideProblems(form, raw.publish);
  const first = Object.values(problems)[0];
  if (first) return { ok: false, error: first, problems };
  return { ok: true, value: { id, version: id ? (version as number) : null, ...form, offered: raw.offered, publish: raw.publish } };
}

/** The toast after a save (`newlyPublished`: this save published a draft). */
export function savedToast(name: string, outcome: { published: boolean; newlyPublished: boolean }): string {
  if (outcome.newlyPublished) return `${name} published. Researchers can see it now.`;
  if (outcome.published) return `${name} saved. Researchers see the change now.`;
  return `Draft saved · ${name}. Researchers can't see it.`;
}

/** "Changed by Priya Sandhu since you opened it. Nothing was saved." (the V5 pattern). */
export const changedSince = (by: string | null) =>
  by ? `Changed by ${by} since you opened it. Nothing was saved.` : "This entry was changed since you opened it. Nothing was saved.";
