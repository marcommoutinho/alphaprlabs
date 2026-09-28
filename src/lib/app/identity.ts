export type AppRole = "admin" | "researcher";

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
