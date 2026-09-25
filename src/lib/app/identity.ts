export type AppRole = "admin" | "researcher";

/** The signed-in person the app shell renders for. */
export interface AppIdentity {
  name: string;
  email: string;
  role: AppRole;
}

/**
 * DEVELOPMENT-ONLY placeholder identities so the shell can render before
 * authentication exists. S2 (accounts, invitations and sign-in) replaces every
 * use of this constant with the verified signed-in identity. Never ship this to
 * researchers or treat it as an authorization decision.
 */
export const DEV_PLACEHOLDER_IDENTITY = {
  admin: { name: "Dev Admin", email: "admin@example.test", role: "admin" },
  researcher: { name: "Dev Researcher", email: "researcher@example.test", role: "researcher" },
} as const satisfies Record<AppRole, AppIdentity>;

/** Up to two initials for the avatar, e.g. "Jordan Reyes" → "JR". */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
