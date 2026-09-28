// Theme resolution for the private app (design v3, COMPONENTS_AND_THEMING §3).
// Pure: shared by the server (cookie → markup and theme-color before first
// paint), the client helper that changes it, and unit tests.
//
// Light is the default. "system" follows prefers-color-scheme. A forced mode
// is kept in a cookie so the server renders it on the first byte (no flash),
// and mirrored as `.light` / `.dark` on <html> when it changes in the page.

export type Appearance = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

/** Cookie holding the person's Appearance choice (Me → Appearance, V4). */
export const APPEARANCE_COOKIE = "alpha-appearance";

/** One year: the choice is a device preference, not a session. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** `paper` in each mode: the status bar / browser chrome colour (§3 "Status bar"). */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#F2F2EE", dark: "#0C0D0F" };

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

/** The stored choice, or "system" for a missing or unknown cookie value. */
export function parseAppearance(value: unknown): Appearance {
  return isAppearance(value) ? value : "system";
}

/** The mode actually shown: a forced choice wins, else the OS preference. */
export function resolveTheme(appearance: Appearance, prefersDark: boolean): ResolvedTheme {
  if (appearance === "system") return prefersDark ? "dark" : "light";
  return appearance;
}

/** Class for <html>: `.light` / `.dark` force a mode; none follows the OS. */
export function htmlClassFor(appearance: Appearance): ResolvedTheme | null {
  return appearance === "system" ? null : appearance;
}

export type ThemeColorDescriptor = { media?: string; color: string };

/**
 * The theme-color meta tags for a choice: one per scheme when following the
 * OS, or the single forced colour (which must not follow the OS).
 */
export function themeColorFor(appearance: Appearance): ThemeColorDescriptor[] {
  if (appearance === "system") {
    return [
      { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
    ];
  }
  return [{ color: THEME_COLOR[appearance] }];
}

/** `document.cookie` assignment that stores the choice ("system" clears it). */
export function appearanceCookie(appearance: Appearance): string {
  const attributes = "Path=/; SameSite=Lax";
  return appearance === "system"
    ? `${APPEARANCE_COOKIE}=; ${attributes}; Max-Age=0`
    : `${APPEARANCE_COOKIE}=${appearance}; ${attributes}; Max-Age=${APPEARANCE_COOKIE_MAX_AGE}`;
}
