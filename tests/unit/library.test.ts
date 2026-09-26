// A2 Peptide library: validation order and exact copy, and the list's display
// text (handoff "A2 Peptide library").
import { describe, expect, it } from "vitest";
import {
  availabilityBadge,
  editorTitle,
  INFORMATION_REQUIRED,
  INVALID_ENTRY,
  libraryMeta,
  NAME_REQUIRED,
  NAME_TAKEN,
  NAME_TOO_LONG,
  referenceNote,
  TEXT_TOO_LONG,
  validateLibraryEntry,
} from "@/lib/library/entry";

const entry = { name: "Compound A", information: "Supplied information.", cyclingOff: "", supplement: "", available: true };

describe("validateLibraryEntry", () => {
  it("uses the handoff's messages, first failure wins", () => {
    expect(NAME_REQUIRED).toBe("Name is required.");
    expect(INFORMATION_REQUIRED).toBe(
      "Add the information researchers will see (incomplete entries can't be published).",
    );
    expect(validateLibraryEntry({ ...entry, name: "  ", information: "" })).toEqual({ ok: false, error: NAME_REQUIRED });
    expect(validateLibraryEntry({ ...entry, information: " \n " })).toEqual({ ok: false, error: INFORMATION_REQUIRED });
    expect(validateLibraryEntry(null)).toEqual({ ok: false, error: NAME_REQUIRED });
    // Refused by the database (names are unique); the product owner's exact copy.
    expect(NAME_TAKEN).toBe("A peptide with this name already exists.");
  });

  it("treats every kind of whitespace as empty, as the database does", () => {
    for (const blank of ["\t", "\n", "\r\n", "\u00a0", " \u2003\u3000\ufeff "]) {
      expect(validateLibraryEntry({ ...entry, name: blank })).toEqual({ ok: false, error: NAME_REQUIRED });
      expect(validateLibraryEntry({ ...entry, information: blank })).toEqual({ ok: false, error: INFORMATION_REQUIRED });
    }
    expect(validateLibraryEntry({ ...entry, name: "\t Compound A\u00a0\r\n" })).toMatchObject({ ok: true, value: { name: "Compound A" } });
  });

  it("refuses a malformed id instead of treating the edit as a new entry", () => {
    for (const id of ["not-a-uuid", "", " ", "0b8f1e2a-1c2d-4e5f-8a9b-0c1d2e3f4a5", 42, {}, true]) {
      expect(validateLibraryEntry({ ...entry, id }), JSON.stringify(id)).toEqual({ ok: false, error: INVALID_ENTRY });
    }
    // The id is checked first: a malformed id is refused even with a blank name.
    expect(validateLibraryEntry({ ...entry, id: "x", name: "" })).toEqual({ ok: false, error: INVALID_ENTRY });
    // Absent or null means a new entry.
    expect(validateLibraryEntry({ ...entry, id: null })).toMatchObject({ ok: true, value: { id: null } });
    expect(validateLibraryEntry({ ...entry, id: undefined })).toMatchObject({ ok: true, value: { id: null } });
  });

  it("trims text, keeps optional guidance blank, and accepts only a uuid id and a true availability", () => {
    const result = validateLibraryEntry({
      ...entry,
      name: "  Compound A ",
      cyclingOff: "  Off for 4 weeks. ",
      available: "yes",
    });
    expect(result).toEqual({
      ok: true,
      value: { ...entry, id: null, cyclingOff: "Off for 4 weeks.", available: false },
    });
    const id = "0B8F1E2A-1C2D-4E5F-8A9B-0C1D2E3F4A5B";
    expect(validateLibraryEntry({ ...entry, id })).toMatchObject({ ok: true, value: { id: id.toLowerCase(), available: true } });
  });

  it("rejects over-long text", () => {
    expect(validateLibraryEntry({ ...entry, name: "x".repeat(121) })).toEqual({ ok: false, error: NAME_TOO_LONG });
    expect(validateLibraryEntry({ ...entry, supplement: "x".repeat(4001) })).toEqual({ ok: false, error: TEXT_TOO_LONG });
    expect(validateLibraryEntry({ ...entry, name: "x".repeat(120), information: "x".repeat(4000) }).ok).toBe(true);
  });
});

describe("list and editor text", () => {
  const counts = { templateCount: 0, cycleCount: 0 };

  it("builds the meta line with guidance flags and the reference count (templates + cycles)", () => {
    expect(libraryMeta({ updatedAt: "2026-08-20T12:00:00Z", cyclingOff: "", supplement: "", ...counts })).toBe(
      "Updated Aug 20, 2026 · no cycling-off guidance · no supplement guidance · referenced by 0",
    );
    expect(
      libraryMeta({ updatedAt: "2026-08-20T12:00:00Z", cyclingOff: "x", supplement: "y", templateCount: 2, cycleCount: 3 }),
    ).toBe("Updated Aug 20, 2026 · cycling-off guidance · supplement guidance · referenced by 5");
  });

  it("shows the availability badge and the researcher-cycles note only when cycles use the entry", () => {
    expect(availabilityBadge(true)).toBe("Available");
    expect(availabilityBadge(false)).toBe("Not offered");
    expect(referenceNote(null)).toBeNull();
    expect(referenceNote({ cycleCount: 0 })).toBeNull();
    expect(referenceNote({ cycleCount: 1 })).toBe(
      "Used in existing researcher cycles. Turning availability off hides it from new cycles only; their records keep referring to it.",
    );
  });

  it("titles the editor from the name as typed", () => {
    expect(editorTitle(true, "Anything")).toBe("New peptide");
    expect(editorTitle(false, "Compound B")).toBe("Edit Compound B");
    expect(editorTitle(false, "  ")).toBe("Edit entry");
  });
});
