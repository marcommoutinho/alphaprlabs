// A2 Peptide library: the entry form's validation and the list's display text
// (handoff docs/design/research-app/README.md, "A2 Peptide library"). Pure and
// shared by the editor, the server action and the tests.
import { formatDate } from "@/lib/format";

/** Mirrors the database checks on public.peptides. */
export const LIBRARY_LIMITS = { name: 120, text: 4000 } as const;

export const NAME_REQUIRED = "Name is required.";
export const INFORMATION_REQUIRED =
  "Add the information researchers will see (incomplete entries can't be published).";
export const NAME_TOO_LONG = `Names can be up to ${LIBRARY_LIMITS.name} characters.`;
export const TEXT_TOO_LONG = "Each text can be up to 4,000 characters.";

/** The editor's fields, as typed. `id` is absent for a new entry. */
export type LibraryEntryInput = {
  id?: string | null;
  name: string;
  information: string;
  cyclingOff: string;
  supplement: string;
  available: boolean;
};

export type ValidLibraryEntry = {
  id: string | null;
  name: string;
  information: string;
  cyclingOff: string;
  supplement: string;
  available: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Validates an entry, first failure wins: name required, then the
 * information researchers see (an entry without it is incomplete and can't be
 * published). Text is trimmed; optional guidance may be blank.
 */
export function validateLibraryEntry(
  input: unknown,
): { ok: true; value: ValidLibraryEntry } | { ok: false; error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const value: ValidLibraryEntry = {
    id: typeof raw.id === "string" && UUID.test(raw.id) ? raw.id.toLowerCase() : null,
    name: text(raw.name),
    information: text(raw.information),
    cyclingOff: text(raw.cyclingOff),
    supplement: text(raw.supplement),
    available: raw.available === true,
  };
  if (!value.name) return { ok: false, error: NAME_REQUIRED };
  if (!value.information) return { ok: false, error: INFORMATION_REQUIRED };
  if (value.name.length > LIBRARY_LIMITS.name) return { ok: false, error: NAME_TOO_LONG };
  if ([value.information, value.cyclingOff, value.supplement].some((t) => t.length > LIBRARY_LIMITS.text)) {
    return { ok: false, error: TEXT_TOO_LONG };
  }
  return { ok: true, value };
}

/** One library entry as A2 lists and edits it. */
export type LibraryEntry = {
  id: string;
  name: string;
  information: string;
  cyclingOff: string;
  supplement: string;
  available: boolean;
  updatedAt: string;
  /** Templates whose plans name this entry (0 until templates exist, S8). */
  templateCount: number;
  /** Researcher cycles whose plans name it (0 until cycles exist, S9). */
  cycleCount: number;
};

/**
 * The list row's meta line, e.g.
 * `Updated Aug 20, 2026 · cycling-off guidance · no supplement guidance · referenced by 2`.
 * "Referenced by" counts templates and researcher cycles together.
 */
export function libraryMeta(entry: Pick<LibraryEntry, "updatedAt" | "cyclingOff" | "supplement" | "templateCount" | "cycleCount">): string {
  return [
    `Updated ${formatDate(entry.updatedAt)}`,
    entry.cyclingOff ? "cycling-off guidance" : "no cycling-off guidance",
    entry.supplement ? "supplement guidance" : "no supplement guidance",
    `referenced by ${entry.templateCount + entry.cycleCount}`,
  ].join(" · ");
}

/** The list badge: "Available" or "Not offered". */
export function availabilityBadge(available: boolean): string {
  return available ? "Available" : "Not offered";
}

/** The editor's note for an entry that researcher cycles use; null otherwise. */
export function referenceNote(entry: Pick<LibraryEntry, "cycleCount"> | null): string | null {
  return entry && entry.cycleCount > 0
    ? "Used in existing researcher cycles. Turning availability off hides it from new cycles only; their records keep referring to it."
    : null;
}

/** The editor card's title; follows the name as it is typed. */
export function editorTitle(isNew: boolean, name: string): string {
  return isNew ? "New peptide" : `Edit ${name.trim() || "entry"}`;
}
