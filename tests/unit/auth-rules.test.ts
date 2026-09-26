import { describe, expect, it } from "vitest";
import { sideSwitchFor } from "@/components/app-shell/nav";
import { hasResearchAccess } from "@/lib/app/identity";
import { destinationFor, safeNextPath, signInUrl } from "@/lib/auth/paths";
import { displayState, normalizeEmail } from "@/lib/invitations/state";

describe("return paths", () => {
  it("accepts only paths inside /app or /admin", () => {
    expect(safeNextPath("/app/progress?x=1")).toBe("/app/progress?x=1");
    expect(safeNextPath("/admin")).toBe("/admin");
    for (const bad of ["//evil.com/app", "https://evil.com", "/auth", "/application", "/app\\x", "", null]) {
      expect(safeNextPath(bad)).toBeNull();
    }
    expect(signInUrl({ next: "/app/today", expired: true })).toBe("/auth?expired=1&next=%2Fapp%2Ftoday");
  });

  it("researchers land on the research side; unacknowledged ones on the acknowledgement", () => {
    expect(destinationFor({ role: "researcher", acknowledged: true })).toBe("/app/today");
    expect(destinationFor({ role: "researcher", acknowledged: true }, "/admin/sales")).toBe("/app/today");
    expect(destinationFor({ role: "researcher", acknowledged: true }, "/app/cycles")).toBe("/app/cycles");
    expect(destinationFor({ role: "researcher", acknowledged: false }, "/app/cycles")).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "researcher", acknowledged: false }, "/admin/sales")).toBe("/auth/acknowledge");
  });

  it("admins are researchers: research side by default, the back office when they asked for it", () => {
    expect(destinationFor({ role: "admin", acknowledged: true })).toBe("/app/today");
    expect(destinationFor({ role: "admin", acknowledged: true }, "/app/cycles")).toBe("/app/cycles");
    expect(destinationFor({ role: "admin", acknowledged: true }, "/admin/sales?x=1")).toBe("/admin/sales?x=1");
    // The research side needs the acknowledgement; the back office does not.
    expect(destinationFor({ role: "admin", acknowledged: false })).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "admin", acknowledged: false }, "/app/today")).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "admin", acknowledged: false }, "/admin")).toBe("/admin");
    expect(destinationFor({ role: "admin", acknowledged: true }, "/administrator")).toBe("/app/today");
  });

  it("the account menu offers the side switch to admins only", () => {
    expect(sideSwitchFor("admin", "research")).toEqual({ label: "Admin", href: "/admin/inventory" });
    expect(sideSwitchFor("admin", "admin")).toEqual({ label: "My research", href: "/app/today" });
    expect(sideSwitchFor("researcher", "research")).toBeNull();
    expect(hasResearchAccess("researcher") && hasResearchAccess("admin")).toBe(true);
  });
});

describe("invitation rules", () => {
  it("shows a pending invitation past its expiry as expired", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(displayState({ state: "pending", expires_at: "2026-09-25T11:59:59Z" }, now)).toBe("expired");
    expect(displayState({ state: "pending", expires_at: "2026-09-25T12:00:01Z" }, now)).toBe("pending");
    expect(displayState({ state: "accepted", expires_at: "2026-01-01T00:00:00Z" }, now)).toBe("accepted");
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Jordan@Example.COM ")).toBe("jordan@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
