// V7 A11 / D8 People and A12 Researcher history: statuses, groups and the
// read-only history's numbers and rows. Pure, no database. Dates are
// America/Toronto; the fixture cycle runs in UTC.
import { describe, expect, it } from "vitest";
import type { CycleRecord } from "@/lib/cycles/rules";
import type { RecordedConfirmation } from "@/lib/cycles/views";
import { accountStatus, deniedHistory, INVITE_NOTE, initials, inviteStatus, peopleView, researcherHistory, sharedBanner } from "@/lib/people/view";
import { shownMeasurement } from "@/lib/preferences/rules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("A11 / D8 statuses", () => {
  it("shared, private, revoked, invited, expired, failed and admin, as the design words them", () => {
    expect(accountStatus({ role: "researcher", sharedSince: "2026-09-10T14:00:00Z", stoppedAt: null })).toEqual({ tone: "shared", text: "Shared since Sep 10" });
    expect(accountStatus({ role: "researcher", sharedSince: null, stoppedAt: null })).toEqual({ tone: "private", text: "Private" });
    // 22:30 on Sep 3 in Toronto.
    expect(accountStatus({ role: "researcher", sharedSince: null, stoppedAt: "2026-09-04T02:30:00Z" })).toEqual({ tone: "private", text: "Private · revoked Sep 3" });
    expect(accountStatus({ role: "admin", sharedSince: null, stoppedAt: null })).toEqual({ tone: "admin", text: "Admin" });
    expect(inviteStatus({ state: "pending", expiresAt: "2026-10-14T15:00:00Z" })).toEqual({ tone: "invited", text: "Invited · expires Oct 14" });
    expect(inviteStatus({ state: "expired", expiresAt: "2026-09-19T15:00:00Z" })).toEqual({ tone: "expired", text: "Invite expired Sep 19" });
    expect(inviteStatus({ state: "failed", expiresAt: "2026-10-19T15:00:00Z" })).toEqual({ tone: "failed", text: "Invite not sent" });
    expect(INVITE_NOTE).toBe("Valid for 30 days. An invitation gives no access to the person's history; only they can share it.");
    expect(initials("Jordan Reyes")).toBe("JR");
    expect(initials("  marco  ")).toBe("M");
    expect(initials("")).toBe("?");
  });

  it("groups accounts by name, then open invitations newest first; only sharing accounts open, never your own", () => {
    const accounts = [
      { id: uuid(1), name: "Kim Tran", email: "kim@example.test", role: "researcher" as const, sharedSince: null, stoppedAt: "2026-09-03T12:00:00Z" },
      { id: uuid(2), name: "Jordan Reyes", email: "jordan@example.test", role: "researcher" as const, sharedSince: "2026-09-10T12:00:00Z", stoppedAt: null },
      { id: uuid(3), name: "Marco Moutinho", email: "marco@example.test", role: "admin" as const, sharedSince: "2026-09-10T12:00:00Z", stoppedAt: null },
      { id: uuid(4), name: "Priya Sandhu", email: "priya@example.test", role: "admin" as const, sharedSince: "2026-09-11T12:00:00Z", stoppedAt: null },
    ];
    const invite = (n: number, state: "pending" | "expired" | "failed" | "accepted", sentAt: string, role: "researcher" | "admin" = "researcher") => ({
      id: uuid(100 + n),
      name: "",
      email: `i${n}@example.test`,
      role,
      state,
      sentAt,
      expiresAt: "2026-10-14T12:00:00Z",
    });
    const view = peopleView(accounts, [invite(1, "expired", "2026-08-20T12:00:00Z"), invite(2, "pending", "2026-09-14T12:00:00Z"), invite(3, "accepted", "2026-09-01T12:00:00Z"), invite(4, "failed", "2026-09-15T12:00:00Z", "admin")], uuid(3));
    expect(view.researchers.map((row) => row.name ?? row.email)).toEqual(["Jordan Reyes", "Kim Tran", "i2@example.test", "i1@example.test"]);
    expect(view.researchers.map((row) => row.historyHref)).toEqual([`/admin/people/${uuid(2)}`, null, null, null]);
    expect(view.researchers.map((row) => row.canResend)).toEqual([false, false, false, true]);
    expect(view.admins.map((row) => [row.name ?? row.email, row.you, row.historyHref !== null])).toEqual([
      ["Marco Moutinho", true, false],
      ["Priya Sandhu", false, true],
      ["i4@example.test", false, false],
    ]);
    expect(view.meta).toBe("4 researchers · 3 admins");
  });
});

describe("A12", () => {
  const PLAN = uuid(11);
  const cycle: CycleRecord = {
    id: uuid(10),
    ownerId: uuid(2),
    name: "Recovery protocol",
    goal: "",
    baseline: "",
    templateId: null,
    templateName: "",
    templateGuidance: "",
    templateUpdatedAt: null,
    currentRevision: 1,
    version: 1,
    createdAt: "2026-08-30T12:00:00Z",
    updatedAt: "2026-08-30T12:00:00Z",
    revisions: [
      {
        id: uuid(12),
        number: 1,
        timeZone: "UTC",
        createdAt: "2026-08-30T12:00:00Z",
        plans: [
          {
            planId: PLAN,
            peptideId: uuid(20),
            effectiveFrom: null,
            phases: [{ id: "ph", kind: "active", start: "2026-09-01", end: "2026-09-30", doseMg: "0.25", time: "08:00", schedule: { type: "interval", everyDays: 1 } }],
          },
        ],
      },
    ],
  };
  const confirmations: RecordedConfirmation[] = [
    { key: `${PLAN}:ph:0`, actualAt: "2026-09-01T08:05:00Z", recordedAt: "2026-09-01T08:05:00Z", amountMg: "0.25", site: "Abdomen L" },
    { key: `${PLAN}:ph:1`, actualAt: "2026-09-02T08:00:00Z", recordedAt: "2026-09-02T09:00:00Z", skipped: true },
  ];
  const checkIn = {
    id: uuid(30),
    day: "2026-09-03",
    feeling: 4,
    effects: [] as string[],
    effectsOther: "",
    note: "",
    measurement: { name: "Weight", value: "82.4", unit: "kg" },
    createdAt: "2026-09-03T21:00:00Z",
  };
  const input = {
    name: "Jordan Reyes",
    sharedSince: "2026-09-10T14:00:00Z",
    cycles: [cycle],
    confirmations: new Map([[cycle.id, confirmations]]),
    checkIns: [checkIn],
    peptides: new Map([[uuid(20), { name: "BPC-157", available: true }]]),
    weightUnit: "kg" as const,
    // Sep 4, 08:00 in Toronto; the Sep 4 dose (08:00 UTC) is due, not settled.
    now: "2026-09-04T12:00:00Z",
  };

  it("the band, the cycle line and the Now block: adherence this cycle, feeling, weight, effect days", () => {
    const history = researcherHistory(input);
    expect(history.banner).toBe("Read-only · shared by Jordan on Sep 10");
    expect(sharedBanner("Jordan Reyes", "2026-09-10T14:00:00Z")).toBe(history.banner);
    expect(history.sub).toBe("Recovery protocol · day 4 of 30");
    expect(history.now).toEqual({ label: "Adherence this cycle", count: "1 of 3", percent: "33", feeling: "4.0", weight: { value: "82.4", unit: "kg" }, effectDays: 0 });
    const lb = shownMeasurement(checkIn.measurement, "lb");
    expect(researcherHistory({ ...input, weightUnit: "lb" }).now.weight).toEqual({ value: lb.value, unit: "lb" });
  });

  // Every-N-days doses after one taken at 8:05 are planned from it (the S7 engine).
  it("recent rows, newest first: the check-in, a dose not logged, a skip, a dose taken with its site", () => {
    expect(researcherHistory(input).recent.map(({ kind, title, flag, sub }) => ({ kind, title, flag, sub }))).toEqual([
      { kind: "check-in", title: "Check-in · Good", flag: "", sub: "Thu Sep 3 · 82.4 kg" },
      { kind: "missed", title: "BPC-157 · 250 mcg", flag: "· Not logged", sub: "Thu Sep 3 · planned 8:05 AM" },
      { kind: "skipped", title: "BPC-157 · 250 mcg", flag: "· Skipped", sub: "Wed Sep 2 · planned 8:05 AM" },
      { kind: "done", title: "BPC-157 · 250 mcg", flag: "", sub: "Tue Sep 1 · 8:05 AM · Abdomen L" },
    ]);
  });

  it("between cycles, and the denied state naming only the person", () => {
    const none = researcherHistory({ ...input, cycles: [], confirmations: new Map() });
    expect(none.sub).toBe("No cycle running");
    expect(none.now).toMatchObject({ label: "Last 30 days", count: "", percent: "—", feeling: "4.0" });
    expect(deniedHistory("Jordan Reyes")).toBe("Jordan hasn't shared their history. Only they can turn it on, from Me.");
  });
});
