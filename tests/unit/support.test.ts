// S17 R11 Me (support access): what the screens show from the caller's own
// share rows. Pure, no database. Times are America/Toronto (EDT, UTC-4 in
// September). Sep 21, 2026 is a Monday. The admin's side (A11 / A12) is
// tests/unit/people.test.ts.
import { describe, expect, it } from "vitest";
import { meSupport, SHARE_POINTS, STOP_POINTS, SUPPORT_INTRO, supplementsSummary, suppliesSummary } from "@/lib/support/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-09-21T16:00:00Z";

describe("R11 support access", () => {
  const shares = [
    { id: uuid(11), startedAt: "2026-09-01T12:00:00Z", stoppedAt: "2026-09-10T13:30:00Z" },
    { id: uuid(12), startedAt: "2026-09-15T11:05:00Z", stoppedAt: null },
    { id: uuid(14), startedAt: "2026-09-12T12:00:00Z", stoppedAt: "2026-09-13T12:00:00Z" },
  ];

  it("shows since when the history is shared, and when it was shared before, newest first", () => {
    expect(meSupport(shares)).toEqual({
      sharedSince: "Shared since Tue Sep 15 · 07:05 · full profile history · until you stop",
      past: "Previously: shared Sep 12, 2026 – Sep 13, 2026; shared Sep 1, 2026 – Sep 10, 2026",
    });
  });

  it("is private before any share, and after the last one stopped", () => {
    expect(meSupport([])).toEqual({ sharedSince: null, past: "" });
    expect(meSupport(shares.filter((s) => s.stoppedAt))).toEqual({
      sharedSince: null,
      past: "Previously: shared Sep 12, 2026 – Sep 13, 2026; shared Sep 1, 2026 – Sep 10, 2026",
    });
  });

  it("shares with the team, never a named admin, and says who can read before sharing", () => {
    expect(SHARE_POINTS[0]).toBe("Every Alpha PR Labs admin can read it, including admins added later.");
    expect(STOP_POINTS[0]).toBe("The team loses access to your history from their next page or request.");
    expect(SUPPORT_INTRO).toContain("with the Alpha PR Labs team");
  });

  it("summarises the optional features: open vials, and routines still running today in Toronto", () => {
    expect(suppliesSummary(false, 3)).toBe("Off");
    expect(suppliesSummary(true, 1)).toBe("1 vial");
    expect(suppliesSummary(true, 0)).toBe("0 vials");
    const routines = [{ endDate: null }, { endDate: "2026-09-21" }, { endDate: "2026-09-20" }];
    expect(supplementsSummary(false, routines, NOW)).toBe("Off");
    expect(supplementsSummary(true, routines, NOW)).toBe("2 routines");
    // 23:30 on Sep 20 in Toronto is still Sep 20 there.
    expect(supplementsSummary(true, [{ endDate: "2026-09-20" }], "2026-09-21T03:30:00Z")).toBe("1 routine");
  });
});
