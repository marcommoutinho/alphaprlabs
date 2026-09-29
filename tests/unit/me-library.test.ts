// V4: R8 Me's preferences (weight conversion, the default syringe, the
// appearance an account and a device resolve to, a patch from a form), the
// sharing history lines, R11 / R12's library rows and "Your mix", and when
// R16 and the push prompt show. Pure. Sep 20, 2026 is a Sunday; Toronto is
// UTC-4 in September.
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { blankMix, builderFromForm, newBuilderPlan, togglePlan } from "@/lib/cycles/builder";
import type { CycleForm, CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { filterRows, libraryMeta, libraryRows, oneLine, peptidesInCycles, updatedLabel, yourMix } from "@/lib/library/screen";
import type { Mixture } from "@/lib/mixtures/rules";
import {
  appearanceRowLabel,
  convertWeight,
  DEFAULT_PREFERENCES,
  KG_PER_LB,
  parsePatch,
  resolveAppearance,
  resolvePreferences,
  resolveSyringe,
  shownMeasurement,
  WEIGHT_UNITS,
  weightIn,
  weightUnitOf,
} from "@/lib/preferences/rules";
import { unitFor } from "@/lib/progress/rules";
import { type DeviceFacts, isAppleSafari, promptsOnLaunch, showsInstallStep } from "@/lib/push/readiness";
import { shareEvents, sharingSince } from "@/lib/support/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("weight unit", () => {
  it("converts exactly: 1 lb is 0.45359237 kg", () => {
    expect(convertWeight("1", "lb", "kg").toString()).toBe(KG_PER_LB);
    expect(convertWeight("100", "lb", "kg").toString()).toBe("45.359237");
    // kg → lb → kg comes back to the same value (200-digit working precision).
    expect(convertWeight(convertWeight("81.4", "kg", "lb"), "lb", "kg").toDecimalPlaces(100, Decimal.ROUND_HALF_UP).toString()).toBe("81.4");
    expect(convertWeight("81.4", "kg", "kg").toString()).toBe("81.4");
  });

  it("shows a weight as stored in its own unit, else converted to one decimal, half up", () => {
    expect(weightIn("81.4", "kg", "kg")).toBe("81.4");
    expect(weightIn("81.40", "kg", "kg")).toBe("81.4");
    expect(weightIn("81.4", "kg", "lb")).toBe("179.5"); // 179.4567…
    expect(weightIn("180", "lb", "kg")).toBe("81.6"); // 81.6466…
    expect(weightIn("0.045359237", "kg", "lb")).toBe("0.1");
    expect(weightIn("heavy", "kg", "lb")).toBeNull();
  });

  it("reads kg and lb units stored in any case, and converts only Weight", () => {
    expect(weightUnitOf(" KG ")).toBe("kg");
    expect(weightUnitOf("lbs")).toBe("lb");
    expect(weightUnitOf("cm")).toBeNull();
    expect(shownMeasurement({ name: "Weight", value: "81.4", unit: "kg" }, "lb")).toEqual({ name: "Weight", value: "179.5", unit: "lb" });
    expect(shownMeasurement({ name: "Weight", value: "180", unit: "lb" }, "lb")).toEqual({ name: "Weight", value: "180", unit: "lb" });
    // Another measurement, or a weight in a unit we don't know, stays as stored.
    expect(shownMeasurement({ name: "Waist", value: "82", unit: "cm" }, "lb")).toEqual({ name: "Waist", value: "82", unit: "cm" });
    expect(shownMeasurement({ name: "Weight", value: "12", unit: "st" }, "kg")).toEqual({ name: "Weight", value: "12", unit: "st" });
  });

  it("defaults to lb (Marco, 2026-09-28), offered first, with kg still a choice", () => {
    expect(DEFAULT_PREFERENCES.weightUnit).toBe("lb");
    expect(WEIGHT_UNITS).toEqual(["lb", "kg"]);
    // The check-in suggests lb for a weight when no unit is given.
    expect(unitFor("Weight")).toBe("lb");
  });
});

describe("default syringe", () => {
  it("a saved mixture's syringe wins; otherwise the account's default", () => {
    expect(resolveSyringe(30, 100)).toBe(30);
    expect(resolveSyringe(null, 50)).toBe(50);
    expect(resolveSyringe(undefined, 30)).toBe(30);
  });

  it("starts the builder's new mixes on it, keeping a saved mix as it is", () => {
    expect(blankMix().syringe).toBe(100);
    expect(blankMix(30)).toMatchObject({ syringe: 30, lineSpacing: "0.5", vialMg: "", liquidMl: "" });
    const form: CycleForm = {
      cycleId: null,
      version: null,
      templateId: null,
      name: "",
      timeZone: "",
      goal: "",
      baseline: "",
      plans: [{ planId: null, peptideId: uuid(1), phases: [{ id: null, kind: "active", day: 1, length: 28, doseMg: "0.25", time: "08:00", schedule: { type: "interval", everyDays: 1 } }] }],
    } as unknown as CycleForm;
    const state = builderFromForm(form, "2026-09-21", { syringe: 50 });
    expect(state.plans[0].mix.syringe).toBe(50);
    // R12's "Add to a cycle": the peptide starts checked with the default syringe.
    const added = togglePlan(state, uuid(2), () => newBuilderPlan(uuid(2), blankMix(30)));
    expect(added.plans.map((plan) => [plan.peptideId, plan.mix.syringe])).toEqual([
      [uuid(1), 50],
      [uuid(2), 30],
    ]);
  });
});

describe("preferences", () => {
  it("default to 100-unit, lb and the device's appearance; anything unexpected reads as the default", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ defaultSyringe: 100, weightUnit: "lb", appearance: null });
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(resolvePreferences({ default_syringe: 100, weight_unit: "kg", appearance: null }).weightUnit).toBe("kg");
    expect(resolvePreferences({ default_syringe: 30, weight_unit: "lb", appearance: "dark" })).toEqual({ defaultSyringe: 30, weightUnit: "lb", appearance: "dark" });
    expect(resolvePreferences({ default_syringe: 40, weight_unit: "st", appearance: "sepia" })).toEqual(DEFAULT_PREFERENCES);
  });

  it("the account's appearance wins once chosen; otherwise the device's cookie", () => {
    expect(resolveAppearance("dark", "light")).toBe("dark");
    expect(resolveAppearance(null, "light")).toBe("light");
    expect(resolveAppearance("system", "dark")).toBe("system");
  });

  it("R8's Appearance row shows the account's choice; before one, this device's, marked as such", () => {
    expect(appearanceRowLabel("dark", "dark")).toBe("Dark");
    expect(appearanceRowLabel("system", "dark")).toBe("System");
    expect(appearanceRowLabel(null, "dark")).toBe("Dark · this device");
    expect(appearanceRowLabel(null, "system")).toBe("System · this device");
  });

  it("takes a patch of known, valid values only", () => {
    expect(parsePatch({ defaultSyringe: 50 })).toEqual({ defaultSyringe: 50 });
    expect(parsePatch({ weightUnit: "lb", appearance: "system" })).toEqual({ weightUnit: "lb", appearance: "system" });
    for (const bad of [null, "lb", {}, { defaultSyringe: 40 }, { weightUnit: "LB" }, { appearance: "dim" }, { name: "x" }, { defaultSyringe: "50" }]) {
      expect(parsePatch(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("sharing history", () => {
  const shares = [
    { id: uuid(2), startedAt: "2026-09-18T13:05:00Z", stoppedAt: null },
    { id: uuid(1), startedAt: "2026-09-11T11:30:00Z", stoppedAt: "2026-09-14T22:00:00Z" },
  ];

  it("lists every start and stop, newest first, in Toronto time, never naming an admin", () => {
    expect(shareEvents(shares).map((event) => [event.kind, event.label, event.time])).toEqual([
      ["shared", "Shared with Alpha PR Labs admins", "Fri, Sep 18, 2026 · 9:05 AM"],
      ["stopped", "Stopped sharing", "Mon, Sep 14, 2026 · 6:00 PM"],
      ["shared", "Shared with Alpha PR Labs admins", "Fri, Sep 11, 2026 · 7:30 AM"],
    ]);
    expect(sharingSince(shares)).toBe("Shared since Fri, Sep 18, 2026 · 9:05 AM");
    expect(sharingSince([shares[1]])).toBeNull();
  });
});

// ── R11 / R12 ───────────────────────────────────────────────────────────────

const TORONTO = "America/Toronto";
const NOW = "2026-09-20T16:00:00Z";
const [PA, PB, PC] = [uuid(901), uuid(902), uuid(903)];
const [PLAN_A, PLAN_B] = [uuid(1), uuid(2)];

const revisionOf = (plans: CycleRevision["plans"]): CycleRevision => ({ id: uuid(100), number: 1, timeZone: TORONTO, createdAt: "2026-09-01T12:00:00Z", plans });
const cycleOf = (id: string, name: string, revision: CycleRevision): CycleRecord => ({
  id,
  ownerId: uuid(600),
  name,
  goal: "",
  baseline: "",
  templateId: null,
  templateName: "",
  templateGuidance: "",
  templateUpdatedAt: null,
  currentRevision: 1,
  version: 1,
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  revisions: [revision],
});

// Running: A every 2 days at 20:00 Sep 10–30, 0.25 mg. Upcoming: A and B from Oct 5. Ended: C in August.
const running = cycleOf(
  uuid(500),
  "Recovery protocol",
  revisionOf([
    {
      planId: PLAN_A,
      peptideId: PA,
      effectiveFrom: null,
      phases: [{ id: uuid(10), kind: "active", start: "2026-09-10", end: "2026-09-30", doseMg: "0.25", time: "20:00", schedule: { type: "interval", everyDays: 2 } }],
    },
  ]),
);
const upcoming = cycleOf(
  uuid(501),
  "Autumn",
  revisionOf([
    {
      planId: uuid(3),
      peptideId: PA,
      effectiveFrom: null,
      phases: [{ id: uuid(11), kind: "active", start: "2026-10-05", end: "2026-10-30", doseMg: "1", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
    },
    {
      planId: PLAN_B,
      peptideId: PB,
      effectiveFrom: null,
      phases: [{ id: uuid(12), kind: "active", start: "2026-10-05", end: "2026-10-30", doseMg: "2.5", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
    },
  ]),
);
const ended = cycleOf(
  uuid(502),
  "Summer",
  revisionOf([
    {
      planId: uuid(4),
      peptideId: PC,
      effectiveFrom: null,
      phases: [{ id: uuid(13), kind: "active", start: "2026-08-01", end: "2026-08-20", doseMg: "1", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
    },
  ]),
);
const mixture: Mixture = {
  id: uuid(700),
  ownerId: uuid(600),
  peptideId: PA,
  version: 1,
  setupNumber: 1,
  setupId: uuid(701),
  setup: { vialMg: "10", liquidMl: "2", syringe: 30, lineSpacing: "0.5" },
  setupSince: "2026-09-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  planIds: [PLAN_A],
};

describe("R11 library", () => {
  const peptides = [
    { id: PA, name: "BPC-157", information: "Pentadecapeptide · tissue repair research. Studied in animal models.", updatedAt: "2026-09-18T15:00:00Z" },
    { id: PB, name: "TB-500", information: "Thymosin beta-4 fragment\nSecond paragraph.", updatedAt: "2026-08-20T15:00:00Z" },
    { id: PC, name: "Glutathione", information: "", updatedAt: "2026-09-01T15:00:00Z" },
  ];

  it("marks the peptides a running or upcoming cycle uses (an ended one no longer counts)", () => {
    expect([...peptidesInCycles([running, upcoming, ended], NOW)].sort()).toEqual([PA, PB]);
    expect([...peptidesInCycles([ended], NOW)]).toEqual([]);
  });

  it("gives each row one line of description, and filters by search and In my cycles", () => {
    const rows = libraryRows(peptides, peptidesInCycles([running], NOW));
    expect(rows.map((row) => [row.name, row.description, row.inCycle])).toEqual([
      ["BPC-157", "Pentadecapeptide · tissue repair research.", true],
      ["TB-500", "Thymosin beta-4 fragment", false],
      ["Glutathione", "", false],
    ]);
    expect(filterRows(rows, "mine", "").map((row) => row.name)).toEqual(["BPC-157"]);
    expect(filterRows(rows, "all", "  thymosin ").map((row) => row.name)).toEqual(["TB-500"]);
    expect(filterRows(rows, "mine", "thymosin")).toEqual([]);
    expect(libraryMeta(peptides)).toBe("3 peptides · updated Sep 18");
    expect(libraryMeta([peptides[0]])).toBe("1 peptide · updated Sep 18");
    expect(updatedLabel("2026-08-20T15:00:00Z")).toBe("Updated Aug 20, 2026");
  });

  it("cuts a long first sentence at a word", () => {
    const long = `${"Growth hormone secretagogue ".repeat(5)}studied widely.`;
    const line = oneLine(long);
    expect(line.endsWith("…")).toBe(true);
    expect([...line].length).toBeLessThanOrEqual(91);
    expect(line).not.toMatch(/\s…$/);
  });
});

describe("R12 Your mix", () => {
  it("reads the running cycle's plan: the saved mix, today's dose and the draw", () => {
    expect(yourMix(PA, [upcoming, running], [mixture], NOW)).toEqual({
      cycleId: running.id,
      cycleName: "Recovery protocol",
      mix: "10 mg + 2 mL",
      syringe: "30-unit syringe",
      strength: { value: "5", unit: "mg/mL" },
      dose: { value: "250", unit: "mcg" },
      draw: { value: "5", unit: "units" },
    });
  });

  it("an upcoming cycle's next dose, without a saved mix: the dose only", () => {
    expect(yourMix(PB, [running, upcoming], [mixture], NOW)).toEqual({
      cycleId: upcoming.id,
      cycleName: "Autumn",
      mix: null,
      syringe: null,
      strength: null,
      dose: { value: "2.5", unit: "mg" },
      draw: null,
    });
  });

  it("nothing for a peptide no current cycle uses", () => {
    expect(yourMix(PC, [running, upcoming, ended], [mixture], NOW)).toBeNull();
    expect(yourMix(PA, [], [mixture], NOW)).toBeNull();
  });
});

// ── R16 and the push prompt ────────────────────────────────────────────────

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const facts = (userAgent: string, extra: Partial<DeviceFacts> = {}): DeviceFacts => ({
  pushApi: true,
  userAgent,
  maxTouchPoints: 5,
  standalone: false,
  permission: "default",
  ...extra,
});

describe("R16 Put Alpha on your Home Screen", () => {
  it("shows in iPhone and iPad Safari only, and not once running from the Home Screen", () => {
    expect(isAppleSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isAppleSafari(IPAD_SAFARI, 5)).toBe(true);
    expect(isAppleSafari(IPAD_SAFARI, 0)).toBe(false); // a Mac
    expect(isAppleSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(showsInstallStep(facts(IPHONE_SAFARI))).toBe(true);
    expect(showsInstallStep(facts(IPHONE_SAFARI, { standalone: true }))).toBe(false);
    expect(showsInstallStep(facts(ANDROID_CHROME))).toBe(false);
    expect(showsInstallStep(facts(IPHONE_CHROME))).toBe(false);
  });

  it("the push prompt opens by itself only on the first standalone launch", () => {
    const standalone = facts(IPHONE_SAFARI, { standalone: true });
    expect(promptsOnLaunch(standalone, { subscribed: false, seen: false })).toBe(true);
    expect(promptsOnLaunch(facts(ANDROID_CHROME, { standalone: true }), { subscribed: false, seen: false })).toBe(true);
    // Never in a browser tab, never twice, never once on or refused, never without push.
    expect(promptsOnLaunch(facts(IPHONE_SAFARI), { subscribed: false, seen: false })).toBe(false);
    expect(promptsOnLaunch(facts(ANDROID_CHROME), { subscribed: false, seen: false })).toBe(false);
    expect(promptsOnLaunch(standalone, { subscribed: false, seen: true })).toBe(false);
    expect(promptsOnLaunch(standalone, { subscribed: true, seen: false })).toBe(false);
    expect(promptsOnLaunch({ ...standalone, permission: "denied" }, { subscribed: false, seen: false })).toBe(false);
    expect(promptsOnLaunch({ ...standalone, pushApi: false }, { subscribed: false, seen: false })).toBe(false);
  });
});
