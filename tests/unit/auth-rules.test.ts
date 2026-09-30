import { describe, expect, it } from "vitest";
import { hasResearchAccess } from "@/lib/app/identity";
import { ACKNOWLEDGEMENT_VERSION, destinationFor, safeNextPath, signInUrl, termsAgreement } from "@/lib/auth/paths";
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

  it("admins and researchers both have the research side", () => {
    expect(hasResearchAccess("researcher") && hasResearchAccess("admin")).toBe(true);
  });
});

describe("the research terms version rule", () => {
  it("only an agreement to the current version counts", () => {
    expect(ACKNOWLEDGEMENT_VERSION).toBe("2026-09-30");
    expect(termsAgreement(ACKNOWLEDGEMENT_VERSION)).toBe("current");
    // Everyone in production agreed to the placeholder: they agree again.
    expect(termsAgreement("2026-09-placeholder")).toBe("outdated");
    for (const other of ["test", "2026-09-30 ", "2026-09-3", "2026-10-01"]) expect(termsAgreement(other), other).toBe("outdated");
    // Never agreed: still joining.
    for (const none of [null, undefined, ""]) expect(termsAgreement(none)).toBe("none");
  });

  it("the research side waits for the current version; the back office never does", () => {
    const outdated = termsAgreement("2026-09-placeholder") === "current";
    expect(destinationFor({ role: "researcher", acknowledged: outdated })).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "researcher", acknowledged: outdated }, "/app/cycles")).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "admin", acknowledged: outdated }, "/app/today")).toBe("/auth/acknowledge");
    expect(destinationFor({ role: "admin", acknowledged: outdated }, "/admin/library")).toBe("/admin/library");
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
