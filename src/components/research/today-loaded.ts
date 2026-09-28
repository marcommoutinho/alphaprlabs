"use client";

import { wallOf } from "@/lib/doses/rules";

// R9c's "Last loaded 8:02 AM": when Today last rendered on this device, kept
// in sessionStorage (a per-viewer convenience; missing in a private window).

const KEY = "alpha.today.loaded";

/** Remembers that Today rendered at `at` (epoch ms), shown in `timeZone`. */
export function rememberLoaded(at: number, timeZone: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at, timeZone }));
  } catch {
    // Storage unavailable: the error screen just leaves the line out.
  }
}

/** The wall-clock "HH:MM" Today last loaded, or null. */
export function lastLoadedWall(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { at, timeZone } = JSON.parse(raw) as { at: number; timeZone: string };
    return wallOf(new Date(at), timeZone).slice(11, 16);
  } catch {
    return null;
  }
}
