// A8 / A9 / D6 Library admin (V7): states, list lines, the usage note,
// vial strengths, the draft / publish rules and the server action's check
// of a submission. Dates are America/Toronto.
import { describe, expect, it } from "vitest";
import {
  addStrength,
  type AdminPeptide,
  changedSince,
  formOfPeptide,
  INVALID_ENTRY,
  libraryCount,
  matchesPeptide,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  newPeptideForm,
  parseStrength,
  peptideProblems,
  peptideState,
  rowMeta,
  rowMetaShort,
  savedToast,
  SHORT_TOO_LONG,
  STATE_LABEL,
  STATE_LINE,
  STRENGTH_DUPLICATE,
  STRENGTH_INVALID,
  STRENGTHS_FULL,
  strengthLabel,
  SUMMARY_REQUIRED,
  SUMMARY_REQUIRED_ERROR,
  TEXT_TOO_LONG,
  usageNote,
  validatePeptide,
} from "@/lib/library/admin";

const ID = "00000000-0000-4000-8000-00000000000a";
const entry: AdminPeptide = {
  id: ID,
  name: "BPC-157",
  shortDescription: "Pentadecapeptide · tissue repair research",
  strengths: ["5", "10"],
  information: "Supplied information.",
  cyclingOff: "",
  supplement: "",
  offered: true,
  publishedAt: "2026-08-01T12:00:00Z",
  version: 3,
  // 22:30 on Aug 20 in Toronto.
  updatedAt: "2026-08-21T02:30:00Z",
  templateCount: 2,
  cycleCount: 4,
};

describe("states and list lines", () => {
  it("draft, offered and not offered, with the design's words", () => {
    expect(peptideState(entry)).toBe("offered");
    expect(peptideState({ ...entry, publishedAt: null })).toBe("draft");
    // A draft stays a draft whatever the switch says; it is applied when published.
    expect(peptideState({ ...entry, publishedAt: null, offered: false })).toBe("draft");
    expect(peptideState({ ...entry, offered: false })).toBe("not-offered");
    expect(STATE_LABEL).toEqual({ offered: "Offered", draft: "Draft", "not-offered": "Not offered" });
    expect(STATE_LINE.draft).toBe("Draft · not visible to researchers");
  });

  it("A8 and D6 lines: when it was updated (Toronto) and a count of cycles, never whose", () => {
    expect(rowMeta(entry)).toBe("Updated Aug 20 · in 4 cycles");
    expect(rowMeta({ ...entry, cycleCount: 1 })).toBe("Updated Aug 20 · in 1 cycle");
    expect(rowMetaShort({ ...entry, cycleCount: 0 })).toBe("Aug 20 · 0 cycles");
    expect(libraryCount([entry, { ...entry, publishedAt: null }])).toBe("2 peptides · 1 draft");
    expect(libraryCount([])).toBe("No peptides yet");
  });

  it("the usage note beside Offered", () => {
    expect(usageNote(entry)).toBe("4 researcher cycles and 2 templates use it. Turning it off won't change them.");
    expect(usageNote({ cycleCount: 1, templateCount: 0 })).toBe("1 researcher cycle uses it. Turning it off won't change them.");
    expect(usageNote({ cycleCount: 0, templateCount: 1 })).toBe("1 template uses it. Turning it off won't change them.");
    expect(usageNote(null)).toBe("No researcher cycle or template uses it yet.");
  });

  it("search matches the name and short description, ignoring case", () => {
    expect(matchesPeptide(entry, "bpc")).toBe(true);
    expect(matchesPeptide(entry, "TISSUE")).toBe(true);
    expect(matchesPeptide(entry, "tb-500")).toBe(false);
    expect(matchesPeptide(entry, "  ")).toBe(true);
  });
});

describe("vial strengths", () => {
  it("reads exact mg, within 100,000 mg and 3 decimals; chips show mcg under 1 mg", () => {
    expect(parseStrength("10")).toEqual({ ok: true, mg: "10" });
    expect(parseStrength("2,5")).toEqual({ ok: true, mg: "2.5" });
    expect(parseStrength("0.250")).toEqual({ ok: true, mg: "0.25" });
    expect(parseStrength("100000")).toEqual({ ok: true, mg: "100000" });
    for (const bad of ["0", "-1", "100000.001", "0.0005", "abc", "", "1,000"]) expect(parseStrength(bad)).toEqual({ ok: false, error: STRENGTH_INVALID });
    expect(strengthLabel("0.25")).toBe("250 mcg");
    expect(strengthLabel("10")).toBe("10 mg");
  });

  it("adds in ascending order, refusing a repeat or a thirteenth", () => {
    expect(addStrength(["10"], "5")).toEqual({ ok: true, list: ["5", "10"] });
    expect(addStrength(["10"], "10.0")).toEqual({ ok: false, error: STRENGTH_DUPLICATE });
    const twelve = Array.from({ length: 12 }, (_, i) => String(i + 1));
    expect(addStrength(twelve, "50")).toEqual({ ok: false, error: STRENGTHS_FULL });
  });
});

describe("draft and publish", () => {
  const form = { ...formOfPeptide(entry) };

  it("a draft needs a name; publishing needs the research summary too", () => {
    const blank = newPeptideForm();
    expect(blank.offered).toBe(true);
    expect(peptideProblems(blank, false)).toEqual({ name: NAME_REQUIRED });
    expect(peptideProblems({ ...blank, name: "Cerebrolysin" }, false)).toEqual({});
    expect(peptideProblems({ ...blank, name: "Cerebrolysin" }, true)).toEqual({ information: SUMMARY_REQUIRED_ERROR });
    expect(SUMMARY_REQUIRED).toBe("Required to publish");
  });

  it("limits: name 120, short description 160, each text 4,000 characters", () => {
    expect(peptideProblems({ ...form, name: "x".repeat(121) }, false).name).toBe(NAME_TOO_LONG);
    expect(peptideProblems({ ...form, shortDescription: "x".repeat(161) }, false).shortDescription).toBe(SHORT_TOO_LONG);
    expect(peptideProblems({ ...form, cyclingOff: "x".repeat(4001) }, false).cyclingOff).toBe(TEXT_TOO_LONG);
    expect(peptideProblems({ ...form, name: "x".repeat(120), shortDescription: "y".repeat(160) }, true)).toEqual({});
  });

  it("the action's check, from the submission alone: trimmed text, canonical strengths, Publish needs a summary", () => {
    const result = validatePeptide({ ...form, name: "  BPC-157 ", strengths: ["10", "5.0"], publish: false });
    expect(result).toEqual({
      ok: true,
      value: { ...form, name: "BPC-157", strengths: ["5", "10"], publish: false },
    });
    expect(validatePeptide({ ...form, information: " ", publish: true })).toMatchObject({ ok: false, error: SUMMARY_REQUIRED_ERROR });
    // A draft save without a summary passes here, even of an entry published since:
    // the database decides that, after replay and compare-and-set (library.test.ts, integration).
    expect(validatePeptide({ ...form, information: " ", publish: false })).toMatchObject({ ok: true });
    expect(validatePeptide({ ...form, id: null, version: null, information: "", publish: false })).toMatchObject({ ok: true });
  });

  it("refuses a malformed submission as unidentified, never as a new entry", () => {
    expect(validatePeptide({ ...form, id: "not-a-uuid", publish: true })).toMatchObject({ ok: false, error: INVALID_ENTRY });
    expect(validatePeptide({ ...form, version: null, publish: true })).toMatchObject({ ok: false, error: INVALID_ENTRY });
    expect(validatePeptide({ ...form, strengths: "10", publish: true })).toMatchObject({ ok: false, error: INVALID_ENTRY });
    expect(validatePeptide({ ...form, publish: "yes" })).toMatchObject({ ok: false, error: INVALID_ENTRY });
    expect(validatePeptide({ ...form, strengths: ["0"], publish: true })).toMatchObject({ ok: false, error: STRENGTH_INVALID });
    expect(validatePeptide(null)).toMatchObject({ ok: false, error: INVALID_ENTRY });
  });

  it("says what a save did, and who saved first", () => {
    expect(savedToast("Cerebrolysin", { published: false, newlyPublished: false })).toBe("Draft saved · Cerebrolysin. Researchers can't see it.");
    expect(savedToast("Cerebrolysin", { published: true, newlyPublished: true })).toBe("Cerebrolysin published. Researchers can see it now.");
    expect(savedToast("BPC-157", { published: true, newlyPublished: false })).toBe("BPC-157 saved. Researchers see the change now.");
    expect(changedSince("Priya Sandhu")).toBe("Changed by Priya Sandhu since you opened it. Nothing was saved.");
    expect(changedSince(null)).toBe("This entry was changed since you opened it. Nothing was saved.");
  });
});
