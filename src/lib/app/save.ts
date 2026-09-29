// What a server action answers about a save, shared by the actions (server)
// and the screens (client): the handoff's failed-save copy and a toast tone.

/** How a screen shows an action's `toast`: "info" as a success toast, "warn" and "error" as an error toast. */
export type ToastTone = "info" | "warn" | "error";

/** Handoff copy for any failed save; the form keeps the person's input. */
export const SAVE_FAILED_MESSAGE = "Could not save. Nothing was lost — your entry is still here. Try again.";
