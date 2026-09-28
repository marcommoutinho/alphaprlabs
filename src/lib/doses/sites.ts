// Injection sites and their rotation (design v3 README "Site rotation", R2).
// Pure and client-safe.
//
// R2's grid has eight sites, in the rotation order: Abdomen L → Abdomen R →
// Thigh L → Thigh R → Delt L → Delt R → Glute L → Glute R, then round again.
// The next site is preselected: the one after the last-used site, so the
// last-used one is always skipped. "Other" (the earlier sheet's fifth
// choice) stays a valid recorded site, but is no longer offered and plays no
// part in the rotation. The last-used site is the one recorded with the
// researcher's latest dose by actual time, across all their peptides (sites
// rotate over the body, not per compound).

/** R2's grid, in rotation order. */
export const ROTATION = ["Abdomen L", "Abdomen R", "Thigh L", "Thigh R", "Delt L", "Delt R", "Glute L", "Glute R"] as const;
export type RotationSite = (typeof ROTATION)[number];

/** Every site a dose may be recorded with (is_dose_site), besides "" (none). */
export const RECORDED_SITES: readonly string[] = [...ROTATION, "Other"];

export const isRotationSite = (site: unknown): site is RotationSite => typeof site === "string" && (ROTATION as readonly string[]).includes(site);

/** A recorded dose as the rotation needs it. */
export type SiteUse = { site: string; actualAt: string; recordedAt?: string };

/** The latest dose (by actual time, then recording time) recorded at a rotation site, or null. */
export function lastSiteUse<T extends SiteUse>(uses: readonly T[]): T | null {
  let best: T | null = null;
  for (const use of uses) {
    if (!isRotationSite(use.site)) continue;
    if (!best) {
      best = use;
      continue;
    }
    const byActual = Date.parse(use.actualAt) - Date.parse(best.actualAt);
    const byRecorded = Date.parse(use.recordedAt ?? use.actualAt) - Date.parse(best.recordedAt ?? best.actualAt);
    if (byActual > 0 || (byActual === 0 && byRecorded > 0)) best = use;
  }
  return best;
}

/** The site to preselect: the next one in the rotation after `last` (the first when there is none). */
export function nextSite(last: string | null | undefined): RotationSite {
  if (!isRotationSite(last)) return ROTATION[0];
  return ROTATION[(ROTATION.indexOf(last) + 1) % ROTATION.length];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * R2's note: "Last: Thigh R, Mon". The day is "today" or "yesterday", the
 * weekday within the past week, else "Sep 12". Dates are local dates
 * (YYYY-MM-DD) in the researcher's zone.
 */
export function lastSiteNote(site: string, usedOn: string, today: string): string {
  const ago = dayNumber(today) - dayNumber(usedOn);
  const at = new Date(`${usedOn}T00:00:00Z`);
  const when =
    ago === 0
      ? "today"
      : ago === 1
        ? "yesterday"
        : ago > 1 && ago < 7
          ? WEEKDAYS[at.getUTCDay()]
          : `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
  return `Last: ${site}, ${when}`;
}
