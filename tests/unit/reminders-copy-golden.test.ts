// The approved notification wording (Astra's list, approved by Marco on
// 2026-09-30), pinned word for word. Every other test compares against the
// constants in src/lib/reminders/copy.ts; this one alone spells the words
// out, so an accidental edit there fails here. A deliberate change of wording
// needs Marco's approval and an update to both.
import { describe, expect, it } from "vitest";
import * as copy from "@/lib/reminders/copy";

const APPROVED = {
  DOSE_DUE_TITLE: "Planned: {peptide}, {amount}",
  DOSE_DUE_BODY_UNITS: "Planned for now: {units} units. Tap to log Taken or Skip.",
  DOSE_DUE_BODY_NO_UNITS: "Your dose is planned for now. Tap to log Taken or Skip.",
  FOLLOWUP_TITLE: "Planned: {peptide}, {amount}",
  FOLLOWUP_BODY: "Final reminder for this dose. Planned for {time}, still not logged. Tap to log Taken or Skip.",
  HEADS_UP_TITLE_ONE: "Planned: {peptide}, {amount} at {time}",
  HEADS_UP_BODY_ONE: "Planned in {minutes}: {units} units. Tap to log Taken or Skip.",
  HEADS_UP_BODY_ONE_NO_UNITS: "Your dose is planned in {minutes}. Tap to log Taken or Skip.",
  HEADS_UP_TITLE_MANY: "Planned: {count} doses at {time}",
  HEADS_UP_BODY_MANY: "{list}. Planned in {minutes}. Tap to log Taken or Skip.",
  SUPPLEMENT_DUE_TITLE: "Planned: {supplement}",
  SUPPLEMENT_DUE_TITLE_AMOUNT: "Planned: {supplement}, {amount}",
  SUPPLEMENT_DUE_BODY: "Your supplement is planned for now. Tap to log Taken.",
  TEST_TITLE: "Test reminder",
  TEST_BODY: "This test reminder reached your phone.",
  SETTING_LABEL: "Advance heads-up",
  SETTING_HINT: "One heads-up for all doses planned at the same time.",
  OPTION_OFF: "Off",
  OPTION_15: "15 minutes before (default)",
  OPTION_30: "30 minutes before",
  OPTION_60: "1 hour before",
};

describe("the approved notification wording", () => {
  it("is copy.ts's, word for word, with no other string constant", () => {
    const strings = Object.fromEntries(Object.entries(copy).filter(([, value]) => typeof value === "string"));
    expect(strings).toEqual(APPROVED);
    expect(copy.HEADS_UP_LEAD_LABEL).toEqual({ 15: "15 minutes", 30: "30 minutes", 60: "1 hour" });
    expect(copy.HEADS_UP_OPTION_LABEL).toEqual({ 0: "Off", 15: "15 minutes before (default)", 30: "30 minutes before", 60: "1 hour before" });
  });

  it("reads as approved once filled", () => {
    const dose = { peptide: "BPC-157", amount: "250 mcg", time: "8:00 AM" };
    expect(copy.doseReminderText("due", { ...dose, units: "10" })).toEqual({
      title: "Planned: BPC-157, 250 mcg",
      body: "Planned for now: 10 units. Tap to log Taken or Skip.",
    });
    expect(copy.doseReminderText("due", { ...dose, units: null })).toEqual({
      title: "Planned: BPC-157, 250 mcg",
      body: "Your dose is planned for now. Tap to log Taken or Skip.",
    });
    expect(copy.doseReminderText("follow-up-1h", { ...dose, units: "10" })).toEqual({
      title: "Planned: BPC-157, 250 mcg",
      body: "Final reminder for this dose. Planned for 8:00 AM, still not logged. Tap to log Taken or Skip.",
    });
    expect(copy.headsUpText({ doses: [{ peptide: "BPC-157", amount: "250 mcg", units: "10" }], time: "8:00 AM", lead: 15 })).toEqual({
      title: "Planned: BPC-157, 250 mcg at 8:00 AM",
      body: "Planned in 15 minutes: 10 units. Tap to log Taken or Skip.",
    });
    expect(copy.headsUpText({ doses: [{ peptide: "BPC-157", amount: "250 mcg", units: null }], time: "8:00 AM", lead: 60 })).toEqual({
      title: "Planned: BPC-157, 250 mcg at 8:00 AM",
      body: "Your dose is planned in 1 hour. Tap to log Taken or Skip.",
    });
    expect(
      copy.headsUpText({
        doses: [
          { peptide: "BPC-157", amount: "250 mcg", units: "10" },
          { peptide: "TB-500", amount: "2 mg", units: null },
        ],
        time: "8:00 AM",
        lead: 30,
      }),
    ).toEqual({
      title: "Planned: 2 doses at 8:00 AM",
      body: "BPC-157 250 mcg, TB-500 2 mg. Planned in 30 minutes. Tap to log Taken or Skip.",
    });
    expect(copy.supplementReminderText({ supplement: "Vitamin D3", amount: "2000 IU" })).toEqual({
      title: "Planned: Vitamin D3, 2000 IU",
      body: "Your supplement is planned for now. Tap to log Taken.",
    });
    expect(copy.supplementReminderText({ supplement: "Vitamin D3", amount: "" })).toEqual({
      title: "Planned: Vitamin D3",
      body: "Your supplement is planned for now. Tap to log Taken.",
    });
  });
});
