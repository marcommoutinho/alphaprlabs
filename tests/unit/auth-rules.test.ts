import { describe, expect, it } from "vitest";
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

  it("sends each role to its own area and unacknowledged researchers to the acknowledgement", () => {
    expect(destinationFor({ role: "admin", acknowledged: false }, "/app/today")).toBe("/admin/inventory");
    expect(destinationFor({ role: "researcher", acknowledged: true }, "/admin/sales")).toBe("/app/today");
    expect(destinationFor({ role: "researcher", acknowledged: true }, "/app/cycles")).toBe("/app/cycles");
    expect(destinationFor({ role: "researcher", acknowledged: false }, "/app/cycles")).toBe("/auth/acknowledge");
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
