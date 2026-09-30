// Notification copy: every title and body a phone shows for Alpha PR Labs.
// This is customer copy, written by Codex Astra and approved by Marco; it
// lives only in this module, so the approved wording replaces these strings
// and nothing else changes. Tests compare against these constants, never
// against literal text.
//
// PLACEHOLDER copy: the dose and supplement reminder wording below is NOT
// approved. It is a marked stand-in until the approved copy arrives; do not
// ship it to researchers (REMINDERS_ENABLED stays off until it is replaced).
//
// Templates fill {name} fields (fillCopy). Dose reminders get:
//   {peptide}  the peptide's name, e.g. "BPC-157"
//   {amount}   the planned amount, e.g. "250 mcg" or "0.4 mg"
//   {time}     the planned time in the cycle's zone, e.g. "8:05 PM"
//   {units}    the syringe units from the saved mix in effect, e.g. "10"
//   {syringe}  that syringe's size, e.g. "1 mL"
// The "noUnits" body is used when there is no saved mix, or its units can't
// be calculated. Supplement reminders get {name}, {amount}, {unit}, {time}.
import type { ReminderKind } from "@/lib/schedule/reminders";

export type DoseCopy = { title: string; body: string; bodyNoUnits: string };

// PLACEHOLDER copy
export const DOSE_REMINDER_COPY: Record<ReminderKind, DoseCopy> = {
  due: {
    title: "[Placeholder] {peptide} due",
    body: "[Placeholder] {amount} at {time}: {units} units on a {syringe} syringe",
    bodyNoUnits: "[Placeholder] {amount} at {time}",
  },
  "follow-up-30m": {
    title: "[Placeholder] {peptide} not logged yet",
    body: "[Placeholder] {amount} planned at {time}: {units} units on a {syringe} syringe",
    bodyNoUnits: "[Placeholder] {amount} planned at {time}",
  },
  "follow-up-2h": {
    title: "[Placeholder] {peptide} still not logged",
    body: "[Placeholder] {amount} planned at {time}: {units} units on a {syringe} syringe",
    bodyNoUnits: "[Placeholder] {amount} planned at {time}",
  },
};

// PLACEHOLDER copy
export const SUPPLEMENT_REMINDER_COPY = {
  title: "[Placeholder] {name}",
  body: "[Placeholder] {amount} {unit} at {time}",
};

// The test notification (Me › Notifications, PUSH_TEST_ENABLED): the wording
// shipped at gate G1, unchanged.
export const TEST_TITLE = "Alpha PR Labs";
export const TEST_BODY = "Test notification — reminders work on this phone.";

/** Replaces each {field} with its value; a field without a value stays as written. */
export function fillCopy(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (field, name: string) => (Object.hasOwn(values, name) ? values[name] : field));
}

export type DoseReminderFacts = {
  peptide: string;
  amount: string;
  time: string;
  /** null: no saved mix, or its units can't be calculated (the noUnits body). */
  units: string | null;
  syringe: string | null;
};

export function doseReminderText(kind: ReminderKind, facts: DoseReminderFacts): { title: string; body: string } {
  const copy = DOSE_REMINDER_COPY[kind];
  const values = { peptide: facts.peptide, amount: facts.amount, time: facts.time, units: facts.units ?? "", syringe: facts.syringe ?? "" };
  const withUnits = facts.units !== null && facts.syringe !== null;
  return { title: fillCopy(copy.title, values), body: fillCopy(withUnits ? copy.body : copy.bodyNoUnits, values) };
}

export type SupplementReminderFacts = { name: string; amount: string; unit: string; time: string };

export function supplementReminderText(facts: SupplementReminderFacts): { title: string; body: string } {
  return { title: fillCopy(SUPPLEMENT_REMINDER_COPY.title, facts), body: fillCopy(SUPPLEMENT_REMINDER_COPY.body, facts) };
}
