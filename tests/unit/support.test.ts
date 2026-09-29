// S17 R8 Me (support access): what the screens show from the caller's own
// share rows. Pure, no database. Times are America/Toronto (EDT, UTC-4 in
// September). Sep 21, 2026 is a Monday. The sharing history is in
// tests/unit/me-library.test.ts; the admin's side (A11 / A12) is
// tests/unit/people.test.ts.
import { describe, expect, it } from "vitest";
import { R17_WHO, sharingSince, STOP_POINTS, supplementsSummary } from "@/lib/support/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-09-21T16:00:00Z";

describe("R8 support access", () => {
  const shares = [
    { id: uuid(11), startedAt: "2026-09-01T12:00:00Z", stoppedAt: "2026-09-10T13:30:00Z" },
    { id: uuid(12), startedAt: "2026-09-15T11:05:00Z", stoppedAt: null },
    { id: uuid(14), startedAt: "2026-09-12T12:00:00Z", stoppedAt: "2026-09-13T12:00:00Z" },
  ];

  it("is private before any share, and after the last one stopped", () => {
    expect(sharingSince(shares)).toBe("Shared since Tue, Sep 15, 2026 · 7:05 AM");
    expect(sharingSince([])).toBeNull();
    expect(sharingSince(shares.filter((s) => s.stoppedAt))).toBeNull();
  });

  it("shares with the team, never a named admin, and says what stopping does", () => {
    expect(R17_WHO).toBe("Alpha PR Labs admins");
    expect(STOP_POINTS[0]).toBe("The team loses access to your history from their next page or request.");
  });

  it("summarises supplement routines still running today in Toronto", () => {
    const routines = [{ endDate: null }, { endDate: "2026-09-21" }, { endDate: "2026-09-20" }];
    expect(supplementsSummary(false, routines, NOW)).toBe("Off");
    expect(supplementsSummary(true, routines, NOW)).toBe("2 routines");
    // 23:30 on Sep 20 in Toronto is still Sep 20 there.
    expect(supplementsSummary(true, [{ endDate: "2026-09-20" }], "2026-09-21T03:30:00Z")).toBe("1 routine");
  });
});
