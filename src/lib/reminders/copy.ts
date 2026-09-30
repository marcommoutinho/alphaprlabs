// Notification copy: every title and body a phone shows for Alpha PR Labs.
// Customer copy, written by Codex Astra (Marco approves it before deploy); it
// lives only in this module, word for word. Tests compare against these
// constants, never against literal text.
//
// Templates fill {name} fields (fillCopy), formatted as Today shows them:
//   {peptide}     the peptide's name, e.g. "BPC-157"
//   {amount}      a dose's planned amount, e.g. "250 mcg" or "2 mg"; a
//                 supplement's amount and unit, e.g. "2000 IU"
//   {time}        the planned time on the phone's clock, e.g. "8:00 AM"
//   {units}       the syringe units from the saved mix in effect, e.g. "10"
//   {syringe}     that syringe's size, e.g. "100-unit"
//   {supplement}  the supplement's name, e.g. "Vitamin D3"
// A due dose without a saved mix (or whose units can't be calculated) gets
// DOSE_DUE_BODY_NO_UNITS. Supplements have only Taken (no Skip), so their
// body says so.
import type { ReminderKind } from "@/lib/schedule/reminders";

export const DOSE_DUE_TITLE = "Planned: {peptide}, {amount}";
export const DOSE_DUE_BODY_UNITS = "Planned for now: {units} units on a {syringe} syringe. Tap to log Taken or Skip.";
export const DOSE_DUE_BODY_NO_UNITS = "Your dose is planned for now. Tap to log Taken or Skip.";
export const FOLLOWUP_30_TITLE = "Planned: {peptide}, {amount}";
export const FOLLOWUP_30_BODY = "Your dose planned for {time} is still not logged. Tap to log Taken or Skip.";
export const FOLLOWUP_2H_TITLE = "Planned: {peptide}, {amount}";
export const FOLLOWUP_2H_BODY = "Final reminder for this dose. Planned for {time}, still not logged. Tap to log Taken or Skip.";
export const SUPPLEMENT_DUE_TITLE = "Planned: {supplement}";
export const SUPPLEMENT_DUE_TITLE_AMOUNT = "Planned: {supplement}, {amount}";
export const SUPPLEMENT_DUE_BODY = "Your supplement is planned for now. Tap to log Taken.";

// The test notification (Me › Notifications, PUSH_TEST_ENABLED).
export const TEST_TITLE = "Test reminder";
export const TEST_BODY = "This test reminder reached your phone.";

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
  syringe: string | null;
};

export function doseReminderText(kind: ReminderKind, facts: DoseReminderFacts): { title: string; body: string } {
  const values = { peptide: facts.peptide, amount: facts.amount, time: facts.time, units: facts.units ?? "", syringe: facts.syringe ?? "" };
  const withUnits = facts.units !== null && facts.syringe !== null;
  const [title, body] =
    kind === "due"
      ? [DOSE_DUE_TITLE, withUnits ? DOSE_DUE_BODY_UNITS : DOSE_DUE_BODY_NO_UNITS]
      : kind === "follow-up-30m"
        ? [FOLLOWUP_30_TITLE, FOLLOWUP_30_BODY]
        : [FOLLOWUP_2H_TITLE, FOLLOWUP_2H_BODY];
  return { title: fillCopy(title, values), body: fillCopy(body, values) };
}

/** `amount`: "2000 IU" (amount and unit), or "" when there is none. */
export type SupplementReminderFacts = { supplement: string; amount: string };

export function supplementReminderText(facts: SupplementReminderFacts): { title: string; body: string } {
  return {
    title: fillCopy(facts.amount ? SUPPLEMENT_DUE_TITLE_AMOUNT : SUPPLEMENT_DUE_TITLE, facts),
    body: fillCopy(SUPPLEMENT_DUE_BODY, facts),
  };
}
