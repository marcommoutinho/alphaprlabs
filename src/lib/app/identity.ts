export type AppRole = "admin" | "researcher";

/**
 * Which navigation the shell shows: the research side (/app) or the admin
 * back office (/admin). Every admin is also a researcher (S3.2), so an admin
 * uses both sides and switches between them from the account menu.
 */
export type AppSide = "research" | "admin";

/** Roles that may use the research side for their own records: researchers and admins. */
export function hasResearchAccess(role: AppRole): boolean {
  return role === "researcher" || role === "admin";
}

/** The signed-in person the app shell renders for. */
export interface AppIdentity {
  name: string;
  email: string;
  role: AppRole;
}

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
