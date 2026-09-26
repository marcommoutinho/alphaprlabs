// R3 Cycle builder copy (the prototype's builder screen and saveBuilder).
// Pure and shared by the screen, the server action and the tests.
import { formatDay } from "@/lib/format";
import type { EditIssue } from "./revise";

export const builderTitle = (editing: boolean) => (editing ? "Edit future plan" : "New cycle");
export const saveLabel = (editing: boolean) => (editing ? "Save future changes" : "Save cycle");
export const scopeNote = (editing: boolean) =>
  editing ? "Applies to future occurrences only." : "You can change future phases any time.";
export const CYCLE_SAVED = "Cycle saved.";
export const FUTURE_PLAN_UPDATED = "Future plan updated. Recorded history is unchanged.";
export const ERRORS_HEADING = "Fix these before saving";
export const fromTemplateNote = (name: string) =>
  `Started from the supplied template “${name}”. This copy is yours — later template changes won't touch it.`;
export const HISTORY_NOTE =
  "This cycle already has recorded doses. Changes here apply to future occurrences only; what you've already confirmed stays exactly as recorded.";
/**
 * Not in the prototype: a plan whose peptide is no longer offered (kept by a
 * cycle, or copied from a template that names it; Marco, 2026-09-26).
 */
export const WITHDRAWN_NOTE = "No longer offered for new cycles.";
/** The template being copied was deleted or can't be read. */
export const TEMPLATE_GONE = "This template is no longer available. Go back to the library and choose another.";

// Not in the prototype (edits there rewrote the whole plan): what the builder
// says when an edit would reach a dose that is already due or recorded.
export function editIssueMessage(issue: EditIssue, nameOf: (peptideId: string) => string): string {
  switch (issue.code) {
    case "ended-changed":
      return `${nameOf(issue.peptideId)}: phase ${issue.phase} has ended, so it can't be changed.`;
    case "ended-removed":
      return `${nameOf(issue.peptideId)}: phases that have ended can't be removed.`;
    case "started-start":
      return `${nameOf(issue.peptideId)}: phase ${issue.phase} has started, so its start date can't change.`;
    case "started-end":
      return `${nameOf(issue.peptideId)}: phase ${issue.phase} has started, so it can end ${formatDay(issue.date)} at the earliest.`;
    case "too-early":
      return `${nameOf(issue.peptideId)}: phase ${issue.phase} can start ${formatDay(issue.date)} at the earliest — changes apply to future doses only.`;
    case "plan-started":
      return `${nameOf(issue.peptideId)} has started, so it can't be removed. End its phases instead.`;
    case "no-future-date":
      return `${nameOf(issue.peptideId)}: these changes would reach doses that are already due. Choose later dates.`;
    default:
      return "This cycle could not be saved. Reload the page and try again.";
  }
}

/** The server's refusals. */
export const CYCLE_CHANGED = "This cycle was changed elsewhere. Reload the page to see the latest plan.";
export const CYCLE_GONE = "This cycle no longer exists.";
export const PAST_REACHED = "Some of these changes would reach doses that are already due. Reload the page and try again.";

/**
 * Time zone choices: every IANA zone this runtime lists, plus `extra` (the
 * cycle's stored zone or the device's, when the list lacks it), sorted.
 */
export function timeZoneOptions(extra: readonly string[] = []): string[] {
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return [...new Set([...list, ...extra.filter(Boolean)])].sort();
}
