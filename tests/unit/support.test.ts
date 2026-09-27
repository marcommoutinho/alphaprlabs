// S17 R11 Me (support access) and A8 Researcher support / history: what the
// screens show, from grant rows and the records an admin read. Pure, no
// database. Times are America/Toronto (EDT, UTC-4 in September) except a
// dose's, which is in its own occurrence's zone. Sep 21, 2026 is a Monday.
import { describe, expect, it } from "vitest";
import type { CycleRecord, CycleRevision } from "@/lib/cycles/rules";
import { cycleOccurrences } from "@/lib/cycles/schedule";
import type { Mixture } from "@/lib/mixtures/rules";
import {
  accessOf,
  deniedText,
  grantedLabel,
  historyView,
  type HistoryInput,
  meSupport,
  NOT_ADMIN_NOTE,
  RECENT,
  supplementsSummary,
  suppliesSummary,
  supportRows,
} from "@/lib/support/view";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [MARCO, DANA, EVE] = [uuid(1), uuid(2), uuid(3)];
const [PA, PW] = [uuid(901), uuid(902)];
const NOW = "2026-09-21T16:00:00Z";

describe("R11 support access", () => {
  const grants = [
    { id: uuid(11), adminId: MARCO, adminName: "Marco", stillAdmin: true, grantedAt: "2026-09-01T12:00:00Z", revokedAt: "2026-09-10T13:30:00Z" },
    { id: uuid(12), adminId: MARCO, adminName: "Marco", stillAdmin: true, grantedAt: "2026-09-15T11:05:00Z", revokedAt: null },
    { id: uuid(13), adminId: DANA, adminName: "Dana", stillAdmin: false, grantedAt: "2026-08-20T12:00:00Z", revokedAt: null },
    { id: uuid(14), adminId: EVE, adminName: "Eve", stillAdmin: true, grantedAt: "2026-09-12T12:00:00Z", revokedAt: "2026-09-13T12:00:00Z" },
  ];
  const admins = [
    { id: MARCO, name: "Marco" },
    { id: EVE, name: "Eve" },
  ];

  it("shows each active grant, offers only admins without one, and lists past grants newest first", () => {
    const view = meSupport(admins, grants);
    expect(view.active).toEqual([
      { adminId: DANA, adminName: "Dana", since: "Granted Thu Aug 20 · 08:00 · full profile history · until you revoke", note: NOT_ADMIN_NOTE },
      { adminId: MARCO, adminName: "Marco", since: "Granted Tue Sep 15 · 07:05 · full profile history · until you revoke", note: "" },
    ]);
    expect(view.grantable).toEqual([{ id: EVE, name: "Eve" }]);
    expect(view.past).toBe("Previously: Eve Sep 12, 2026 – Sep 13, 2026; Marco Sep 1, 2026 – Sep 10, 2026");
  });

  it("offers every admin before any grant, and says nothing of the past", () => {
    expect(meSupport(admins, [])).toEqual({ active: [], grantable: admins, past: "" });
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

describe("A8 Researcher support", () => {
  const accounts = [
    { id: uuid(21), name: "Zoe None", email: "zoe@example.test", grantedAt: null, revokedAt: null },
    { id: uuid(22), name: "Riley Revoked", email: "riley@example.test", grantedAt: null, revokedAt: "2026-09-18T14:00:00Z" },
    { id: uuid(23), name: "Jordan Reyes", email: "jordan@example.test", grantedAt: "2026-09-19T12:15:00Z", revokedAt: "2026-09-10T12:00:00Z" },
    { id: uuid(24), name: "Avery None", email: "avery@example.test", grantedAt: null, revokedAt: null },
  ];

  it("lists granted, then revoked, then the rest, each with the designed state and line", () => {
    expect(supportRows(accounts).map((row) => [row.name, row.state, row.sub])).toEqual([
      ["Jordan Reyes", "Access granted", "Read-only since Sat Sep 19 · 08:15"],
      ["Riley Revoked", "Revoked", "Revoked Fri Sep 18 · 10:00 — opening will be denied"],
      ["Avery None", "No access", "They haven't granted access"],
      ["Zoe None", "No access", "They haven't granted access"],
    ]);
    // A newer grant after a revoke is access granted.
    expect(accessOf(accounts[2])).toBe("granted");
  });

  it("explains a denial: revoked, or never granted", () => {
    expect(deniedText(accounts[1])).toBe(
      "Riley Revoked revoked your access on Fri Sep 18 · 10:00. Their history is private again; you'd need a new grant from them.",
    );
    expect(deniedText(accounts[0])).toBe("Zoe None hasn't shared their history with you. Only they can grant access, from their own profile.");
    expect(grantedLabel("2026-09-19T12:15:00Z")).toBe("Read-only · granted Sat Sep 19 · 08:15");
  });
});

describe("A8 Researcher history", () => {
  const [PLAN_A, PLAN_W, PHASE_A, PHASE_W] = [uuid(31), uuid(32), uuid(33), uuid(34)];
  const revision = (timeZone: string, planId: string, phaseId: string, peptideId: string, start: string, end: string): CycleRevision => ({
    id: uuid(40 + start.length),
    number: 1,
    timeZone,
    createdAt: "2026-09-01T12:00:00Z",
    plans: [
      {
        planId,
        peptideId,
        effectiveFrom: null,
        phases: [{ id: phaseId, kind: "active", start, end, doseMg: "0.4", time: "20:00", schedule: { type: "interval", everyDays: 1 } }],
      },
    ],
  });
  const cycle = (id: string, name: string, goal: string, rev: CycleRevision): CycleRecord => ({
    id,
    ownerId: uuid(600),
    name,
    goal,
    baseline: "",
    templateId: null,
    templateName: "",
    templateGuidance: "",
    templateUpdatedAt: null,
    currentRevision: 1,
    version: 1,
    createdAt: rev.createdAt,
    updatedAt: rev.createdAt,
    revisions: [rev],
  });
  const toronto = cycle(uuid(51), "Recomp Spring 26", "Body composition", revision("America/Toronto", PLAN_A, PHASE_A, PA, "2026-09-01", "2026-09-30"));
  // A peptide no longer offered, in Tokyo time, ended.
  const tokyo = cycle(uuid(52), "Sleep", "", revision("Asia/Tokyo", PLAN_W, PHASE_W, PW, "2026-08-01", "2026-08-20"));
  const occurrenceKey = (c: CycleRecord, date: string) => cycleOccurrences(c.revisions).find((o) => o.localDate === date)!.key;

  const dosesA = Array.from({ length: 10 }, (_, i) => {
    const date = `2026-09-${String(10 + i).padStart(2, "0")}`;
    return { id: uuid(100 + i), cycleId: toronto.id, planId: PLAN_A, occurrenceKey: occurrenceKey(toronto, date), actualAt: `${date}T23:05:00Z`, amountMg: "0.400" };
  });
  const doseW = { id: uuid(200), cycleId: tokyo.id, planId: PLAN_W, occurrenceKey: occurrenceKey(tokyo, "2026-08-02"), actualAt: "2026-08-02T11:00:00Z", amountMg: "0.25" };
  const mixture: Mixture = {
    id: uuid(300),
    ownerId: uuid(600),
    peptideId: PA,
    version: 1,
    setupNumber: 1,
    setupId: uuid(301),
    setup: { vialMg: "10", liquidMl: "2", syringe: 100, lineSpacing: "2" },
    setupSince: "2026-09-01T12:00:00Z",
    createdAt: "2026-09-01T12:00:00Z",
    planIds: [PLAN_A],
  };
  const base: HistoryInput = {
    cycles: [toronto, tokyo],
    doses: [...dosesA, doseW],
    confirmations: new Map(),
    checkIns: Array.from({ length: 7 }, (_, i) => ({
      id: uuid(400 + i),
      day: `2026-09-${String(14 + i).padStart(2, "0")}`,
      feeling: 1 + (i % 5),
      effects: i === 6 ? ["Mild headache", "Nausea"] : ["None noticed"],
      note: i === 6 ? "Slept better." : "",
      measurement: i % 2 === 0 ? { name: "Weight", value: `8${i}.5`, unit: "kg" } : null,
    })),
    supplyTracking: true,
    vials: [
      { id: uuid(500), peptideId: PA, label: "A-01", strengthMg: "10", finishedAt: null },
      { id: uuid(501), peptideId: PW, label: "W-01", strengthMg: "5", finishedAt: "2026-08-21T12:00:00Z" },
      { id: uuid(502), peptideId: PA, label: "A-02", strengthMg: "0.5", finishedAt: null },
    ],
    mixtures: [mixture],
    deductions: [
      { vialId: uuid(500), amountMg: "0.4" },
      { vialId: uuid(500), amountMg: "0.4" },
      { vialId: uuid(502), amountMg: "0.7" },
    ],
    supplementTracking: true,
    routines: [
      { id: uuid(600), name: "Vitamin D3", amount: "2000", unit: "IU", time: "08:00", endDate: null },
      { id: uuid(601), name: "Magnesium", amount: "200", unit: "mg", time: "21:00", endDate: "2026-09-12" },
    ],
    taken: [{ id: uuid(700), name: "Vitamin D3", amount: "2000", unit: "IU", actualAt: "2026-09-20T12:10:00Z" }],
    peptides: new Map([
      [PA, { name: "Compound A" }],
      [PW, { name: "Withdrawn W" }],
    ]),
    now: NOW,
    full: false,
  };

  it("shows every cycle with its status, dates, peptides (withdrawn ones by name) and goal", () => {
    expect(historyView(base).cycles).toEqual([
      { id: toronto.id, name: "Recomp Spring 26", status: "Active", dates: "Sep 1 – Sep 30, 2026", peptides: "Compound A", goal: "Body composition" },
      { id: tokyo.id, name: "Sleep", status: "Ended", dates: "Aug 1 – Aug 20, 2026", peptides: "Withdrawn W", goal: "—" },
    ]);
  });

  it("shows the most recent administrations first, each in its occurrence's own zone", () => {
    const view = historyView(base);
    expect(view.doses).toHaveLength(RECENT.doses);
    expect(view.doses[0]).toEqual({ id: uuid(109), peptide: "Compound A", mg: "0.4 mg", time: "Sat Sep 19 · 19:05" });
    expect(view.cut).toBe(true);
    expect(view.counts).toEqual({ doses: 11, checkIns: 7, taken: 1 });

    const full = historyView({ ...base, full: true });
    expect(full.doses).toHaveLength(11);
    expect(full.doses.at(-1)).toEqual({ id: doseW.id, peptide: "Withdrawn W", mg: "0.25 mg", time: "Sun Aug 2 · 20:00" });
    expect(full.cut).toBe(false);
  });

  it("falls back to the cycle's zone for a dose whose occurrence is no longer scheduled", () => {
    const moved = { ...doseW, occurrenceKey: `${PLAN_W}:${PHASE_W}:999` };
    expect(historyView({ ...base, doses: [moved] }).doses[0].time).toBe("Sun Aug 2 · 20:00");
  });

  it("shows check-ins newest first with their effects and notes, and the measurements", () => {
    const view = historyView(base);
    expect(view.checkIns).toHaveLength(RECENT.checkIns);
    expect(view.checkIns[0]).toEqual({ id: uuid(406), date: "Sun Sep 20", feeling: 2, effects: "Mild headache, Nausea", note: "Slept better." });
    expect(view.checkIns[1].effects).toBe("");
    expect(view.measures).toBe("Measurements: Weight 86.5 kg (Sep 20) · Weight 84.5 kg (Sep 18) · Weight 82.5 kg (Sep 16) · Weight 80.5 kg (Sep 14)");
  });

  it("describes supplies, mixtures and supplements as the prototype does", () => {
    const view = historyView(base);
    expect(view.supplies).toBe(
      "Supplies tracked: A-01 · Compound A 10 mg · est. 9.2 mg left; A-02 · Compound A 0.5 mg · est. 0 mg left (0.2 mg over); W-01 · Withdrawn W 5 mg · finished Aug 21, 2026",
    );
    expect(view.mixtures).toBe("Saved mixtures: Compound A · 10 mg / 2 mL · 1 mL");
    expect(view.supplements).toBe("Supplement routines: Vitamin D3 2000 IU daily 08:00; Magnesium 200 mg daily 21:00 (ended Sep 12, 2026)");
    expect(view.taken).toEqual([{ id: uuid(700), line: "Vitamin D3 · 2000 IU", time: "Sun Sep 20 · 08:10" }]);
  });

  it("says when the optional features are off or unused, and keeps what was recorded while off", () => {
    const off = historyView({ ...base, supplyTracking: false, supplementTracking: false });
    expect(off.supplies).toMatch(/^Supplies tracking is off\. Vials kept: A-01/);
    expect(off.supplements).toMatch(/^Supplement tracking is off\. Routines kept: Vitamin D3/);
    const empty = historyView({ ...base, vials: [], routines: [], mixtures: [], taken: [], supplyTracking: false, supplementTracking: false });
    expect(empty.supplies).toBe("Personal supplies: optional feature not used.");
    expect(empty.supplements).toBe("Supplement routines: optional feature not used.");
    expect(empty.mixtures).toBe("");
    const on = historyView({ ...base, vials: [], routines: [] });
    expect(on.supplies).toBe("Supplies tracking is on but no vials are recorded.");
    expect(on.supplements).toBe("Supplement tracking is on but no routines exist.");
  });

  it("shows an empty history without inventing records", () => {
    const view = historyView({ ...base, cycles: [], doses: [], checkIns: [], vials: [], mixtures: [], routines: [], taken: [], deductions: [] });
    expect(view).toMatchObject({ cycles: [], doses: [], checkIns: [], measures: "", taken: [], cut: false });
  });
});
