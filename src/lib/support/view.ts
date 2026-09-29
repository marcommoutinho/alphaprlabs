// R8 Me's support access: what the screens show (with Marco's
// simplification, 2026-09-27: a researcher shares with the whole Alpha PR
// Labs team, never with a chosen admin, and a researcher never sees which
// admin reads). Pure: built from the caller's own share rows, shared by the
// screens and the tests. Times are America/Toronto (the business is local).
// The admin's side (A11 People, A12 a shared history) is src/lib/people/view.ts.
import { formatDateTime12 } from "@/lib/format";
import type { InstantInput } from "@/lib/schedule/zone";
import { todayIn } from "@/lib/supplements/schedule";

/** Share times are shown in the business's zone. */
export const SUPPORT_TIME_ZONE = "America/Toronto";

// ── Copy ────────────────────────────────────────────────────────────────────

export const STOP_POINTS = [
  "The team loses access to your history from their next page or request.",
  "Nothing in your history changes.",
  "You can share again later; it starts a new share.",
] as const;
export const SHARED_TOAST = "Your history is shared with the Alpha PR Labs team. Stop sharing any time.";
export const STOPPED_TOAST = "Sharing stopped. The team can no longer open your history.";
export const ALREADY_STOPPED = "Sharing had already stopped. Your history is private.";

export type ShareRow = { id: string; startedAt: string; stoppedAt: string | null };

// ── R8 Me · Support access and R17 (design v3) ──────────────────────────────
// Marco's rules win over the design: the team is "Alpha PR Labs admins",
// never a named admin, and stopping asks for confirmation first (the design
// turns it off at once).

export const R8_TITLE = "Let admins view my history";
export const R8_COPY =
  "Alpha PR Labs admins would see your cycles, logged doses and check-ins, read-only. You can turn this off at any time and it takes effect straight away.";
export const R17_TITLE = "Let admins view your history?";
export const R17_WHO = "Alpha PR Labs admins";
export const R17_WHO_SUB = "Everyone with admin access to the app";
export const R17_SEE = ["Cycles and schedules", "Logged doses and sites", "Check-ins and weight", "Vials and supplements"] as const;
export const R17_CANT = ["Edit anything", "Log on your behalf", "See it after you turn this off"] as const;
export const R17_ALLOW = "Allow read-only access";
export const STOP_TITLE = "Stop sharing your history?";
export const STOP_KEEP = "Keep sharing";

/** One line of R8's sharing history: when sharing started or stopped. */
export type ShareEvent = { key: string; kind: "shared" | "stopped"; at: string; label: string; time: string };

/**
 * R8's sharing history ("Keep a grant history"): every share's start and
 * stop, newest first, from the caller's own shares. Names no admin.
 */
export function shareEvents(shares: readonly ShareRow[]): ShareEvent[] {
  const events: ShareEvent[] = [];
  for (const share of shares) {
    events.push({ key: `${share.id}:shared`, kind: "shared", at: share.startedAt, label: "Shared with Alpha PR Labs admins", time: when12(share.startedAt) });
    if (share.stoppedAt) events.push({ key: `${share.id}:stopped`, kind: "stopped", at: share.stoppedAt, label: "Stopped sharing", time: when12(share.stoppedAt) });
  }
  // A stop sorts after its own start at the same instant (newest first).
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === b.kind ? b.key.localeCompare(a.key) : a.kind === "stopped" ? -1 : 1));
}

const when12 = (at: string) => formatDateTime12(at, { timeZone: SUPPORT_TIME_ZONE });

/** R8's card line while sharing: "Shared since Fri, Sep 11, 2026 · 7:30 AM", or null when private. */
export function sharingSince(shares: readonly ShareRow[]): string | null {
  const active = shares.find((s) => s.stoppedAt === null);
  return active ? `Shared since ${when12(active.startedAt)}` : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Me's "Supplement routines" line: routines still running (an end date today or later), else "Off". */
export function supplementsSummary(tracking: boolean, routines: readonly { endDate: string | null }[], now: InstantInput): string {
  if (!tracking) return "Off";
  const today = todayIn(now, SUPPORT_TIME_ZONE);
  return plural(routines.filter((r) => r.endDate === null || r.endDate >= today).length, "routine");
}
