// Which saved-mixture setup a plan used at an instant (S12), so the R5 sheet
// shows the syringe units of the setup in effect at the actual time chosen
// and sends that setup's version id: confirm_dose() refuses the confirmation
// (AP020) when the database resolves another one (a mixture saved, changed or
// unlinked since the page was loaded).
//
// Mirrors public.plan_mixture_version_at (20260926190000_mixtures.sql): the
// links in effect at t (linked_at <= t < unlinked_at) and, among their
// mixtures' versions created at or before t, the highest number. Instants are
// compared exactly (microseconds, as stored), with Temporal. Pure and
// client-safe.
import { Temporal } from "@js-temporal/polyfill";
import type { DrawSetup } from "./rules";

/** One link of a plan to a saved mixture (cycle_plan_mixtures). */
export type SetupLink = { mixtureId: string; linkedAt: string; unlinkedAt: string | null };
/** One saved setup of a mixture (mixture_versions). */
export type SetupVersion = { id: string; mixtureId: string; number: number; createdAt: string; setup: DrawSetup };
/** A span of time [from, to) during which the plan used one setup (to null: still in use). */
export type SetupSegment = { from: string; to: string | null; versionId: string; setup: DrawSetup };

const instant = (iso: string) => Temporal.Instant.from(iso);
const compare = (a: string, b: string) => Temporal.Instant.compare(instant(a), instant(b));

/** The setup a plan with these links used at `at`, or null (no mixture then). */
export function versionAt(links: readonly SetupLink[], versions: readonly SetupVersion[], at: string): SetupVersion | null {
  const mixtures = new Set(
    links.filter((l) => compare(l.linkedAt, at) <= 0 && (l.unlinkedAt === null || compare(l.unlinkedAt, at) > 0)).map((l) => l.mixtureId),
  );
  let best: SetupVersion | null = null;
  for (const v of versions) {
    if (mixtures.has(v.mixtureId) && compare(v.createdAt, at) <= 0 && (!best || v.number > best.number)) best = v;
  }
  return best;
}

/** The plan's setups over time, oldest first; spans without a mixture are left out. */
export function setupSegments(links: readonly SetupLink[], versions: readonly SetupVersion[]): SetupSegment[] {
  const mixtures = new Set(links.map((l) => l.mixtureId));
  const own = versions.filter((v) => mixtures.has(v.mixtureId));
  // The setup can only change at a link's start or end or at a new version.
  const points = [...links.flatMap((l) => (l.unlinkedAt ? [l.linkedAt, l.unlinkedAt] : [l.linkedAt])), ...own.map((v) => v.createdAt)]
    .sort(compare)
    .filter((point, i, all) => i === 0 || compare(all[i - 1], point) !== 0);
  const segments: SetupSegment[] = [];
  points.forEach((from, i) => {
    const version = versionAt(links, own, from);
    const to = points[i + 1] ?? null;
    const last = segments.at(-1);
    if (last && last.to === from && version && last.versionId === version.id) {
      last.to = to;
      return;
    }
    if (version) segments.push({ from, to, versionId: version.id, setup: version.setup });
  });
  return segments;
}

/** The segment in effect at `at`, or null. */
export function setupAt(segments: readonly SetupSegment[], at: string): SetupSegment | null {
  return segments.find((s) => compare(s.from, at) <= 0 && (s.to === null || compare(s.to, at) > 0)) ?? null;
}
