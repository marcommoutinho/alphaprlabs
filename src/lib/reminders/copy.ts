// Notification copy: every title and body a phone shows for Alpha PR Labs,
// and the Advance heads-up setting's words. Customer copy (final wording,
// Marco, 2026-09-30); it lives only in this module, word for word. Tests
// compare against these constants, never against literal text.
//
// Templates fill {name} fields (fillCopy), formatted as Today shows them:
//   {peptide}     the peptide's name, e.g. "BPC-157"
//   {amount}      a dose's planned amount, e.g. "250 mcg" or "2 mg"; a
//                 supplement's amount and unit, e.g. "2000 IU"
//   {time}        the planned time on the phone's clock, e.g. "8:00 AM"
//   {units}       the syringe units from the saved mix in effect, e.g. "10"
//                 (never the syringe's size: units only)
//   {minutes}     the heads-up's lead: "15 minutes", "30 minutes" or "1 hour"
//   {count}       how many doses a grouped heads-up covers, e.g. "2"
//   {list}        those doses as "BPC-157 250 mcg, TB-500 2 mg", in the order
//                 Today shows them
//   {supplement}  the supplement's name, e.g. "Vitamin D3"
// A dose without a saved mix (or whose units can't be calculated) gets the
// _NO_UNITS body. Supplements have only Taken (no Skip), so their body says
// so; they get no heads-up and no follow-up.
import type { HeadsUpMinutes } from "@/lib/preferences/rules";
import type { ReminderKind } from "@/lib/schedule/reminders";

export const DOSE_DUE_TITLE = "Planned: {peptide}, {amount}";
export const DOSE_DUE_BODY_UNITS = "Planned for now: {units} units. Tap to log Taken or Skip.";
export const DOSE_DUE_BODY_NO_UNITS = "Your dose is planned for now. Tap to log Taken or Skip.";
export const FOLLOWUP_TITLE = "Planned: {peptide}, {amount}";
export const FOLLOWUP_BODY = "Final reminder for this dose. Planned for {time}, still not logged. Tap to log Taken or Skip.";
export const HEADS_UP_TITLE_ONE = "Planned: {peptide}, {amount} at {time}";
export const HEADS_UP_BODY_ONE = "Planned in {minutes}: {units} units. Tap to log Taken or Skip.";
export const HEADS_UP_BODY_ONE_NO_UNITS = "Your dose is planned in {minutes}. Tap to log Taken or Skip.";
export const HEADS_UP_TITLE_MANY = "Planned: {count} doses at {time}";
export const HEADS_UP_BODY_MANY = "{list}. Planned in {minutes}. Tap to log Taken or Skip.";
export const SUPPLEMENT_DUE_TITLE = "Planned: {supplement}";
export const SUPPLEMENT_DUE_TITLE_AMOUNT = "Planned: {supplement}, {amount}";
export const SUPPLEMENT_DUE_BODY = "Your supplement is planned for now. Tap to log Taken.";

// The test notification (Me › Notifications, PUSH_TEST_ENABLED).
export const TEST_TITLE = "Test reminder";
export const TEST_BODY = "This test reminder reached your phone.";

// The Advance heads-up setting (Me › Notifications).
export const SETTING_LABEL = "Advance heads-up";
export const SETTING_HINT = "One heads-up for all doses planned at the same time.";
export const OPTION_OFF = "Off";
export const OPTION_15 = "15 minutes before (default)";
export const OPTION_30 = "30 minutes before";
export const OPTION_60 = "1 hour before";

/** The setting's choices, as the picker lists them. */
export const HEADS_UP_OPTION_LABEL: Record<HeadsUpMinutes, string> = { 0: OPTION_OFF, 15: OPTION_15, 30: OPTION_30, 60: OPTION_60 };

/** {minutes} for each lead. */
export const HEADS_UP_LEAD_LABEL: Record<Exclude<HeadsUpMinutes, 0>, string> = { 15: "15 minutes", 30: "30 minutes", 60: "1 hour" };

/** Replaces each {field} with its value; a field without a value stays as written. */
export function fillCopy(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (field, name: string) => (Object.hasOwn(values, name) ? values[name] : field));
}

export type DoseReminderFacts = {
  peptide: string;
  amount: string;
  time: string;
  /** null: no saved mix, or its units can't be calculated. */
  units: string | null;
};

export function doseReminderText(kind: ReminderKind, facts: DoseReminderFacts): { title: string; body: string } {
  const values = { peptide: facts.peptide, amount: facts.amount, time: facts.time, units: facts.units ?? "" };
  const [title, body] =
    kind === "due" ? [DOSE_DUE_TITLE, facts.units !== null ? DOSE_DUE_BODY_UNITS : DOSE_DUE_BODY_NO_UNITS] : [FOLLOWUP_TITLE, FOLLOWUP_BODY];
  return { title: fillCopy(title, values), body: fillCopy(body, values) };
}

export type HeadsUpFacts = {
  /** The doses planned at that time, in Today's order (at least one). */
  doses: readonly Omit<DoseReminderFacts, "time">[];
  time: string;
  lead: Exclude<HeadsUpMinutes, 0>;
};

/** One heads-up for every dose planned at the same time: the dose's own words for one, a list for several. */
export function headsUpText(facts: HeadsUpFacts): { title: string; body: string } {
  const minutes = HEADS_UP_LEAD_LABEL[facts.lead];
  if (facts.doses.length === 1) {
    const [dose] = facts.doses;
    const values = { peptide: dose.peptide, amount: dose.amount, time: facts.time, minutes, units: dose.units ?? "" };
    return {
      title: fillCopy(HEADS_UP_TITLE_ONE, values),
      body: fillCopy(dose.units !== null ? HEADS_UP_BODY_ONE : HEADS_UP_BODY_ONE_NO_UNITS, values),
    };
  }
  const values = {
    count: String(facts.doses.length),
    time: facts.time,
    minutes,
    list: facts.doses.map((dose) => `${dose.peptide} ${dose.amount}`).join(", "),
  };
  return { title: fillCopy(HEADS_UP_TITLE_MANY, values), body: fillCopy(HEADS_UP_BODY_MANY, values) };
}

/** `amount`: "2000 IU" (amount and unit), or "" when there is none. */
export type SupplementReminderFacts = { supplement: string; amount: string };

export function supplementReminderText(facts: SupplementReminderFacts): { title: string; body: string } {
  return {
    title: fillCopy(facts.amount ? SUPPLEMENT_DUE_TITLE_AMOUNT : SUPPLEMENT_DUE_TITLE, facts),
    body: fillCopy(SUPPLEMENT_DUE_BODY, facts),
  };
}
