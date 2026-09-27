// The database's copy of the schedule (20260926200000_doses.sql) matches the
// S7 engine with recorded doses: cycle_phase_occurrences() gives the same
// keys, scheduled instants and actual times as scheduleOccurrences() for
// every-N-days and fixed-weekday phases with confirmations — late, early,
// backdated, recorded together, past the phase end — with time changes and
// across daylight-saving gaps and repeats. Read-only SQL as the database
// owner (the functions are internal), so it runs in integration-exclusive.
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { type ActivePhase, type Confirmation, scheduleOccurrences, type Weekday } from "@/lib/schedule/engine";
import { micros, mulberry32, psql, quote, sqlMicros } from "../support/psql";

const ZONES = ["America/Toronto", "Europe/Lisbon", "Australia/Lord_Howe", "America/Santiago", "Asia/Kolkata", "UTC"];
// Around US, EU, Lord Howe and Chile daylight-saving changes in 2026.
const STARTS = ["2026-03-04", "2026-03-25", "2026-04-01", "2026-09-02", "2026-09-30", "2026-10-21", "2026-10-29"];
const TIMES = ["00:30", "01:30", "02:15", "02:30", "08:00", "20:05", "23:30"];

type Case = { label: string; zone: string; planId: string; phase: ActivePhase; confirmations: Confirmation[] };

function phaseRow(phase: ActivePhase) {
  return {
    phase_id: phase.id,
    kind: "active",
    start_date: phase.start,
    end_date: phase.end,
    dose_mg: phase.doseMg,
    local_time: phase.time,
    schedule_type: phase.schedule.type,
    every_days: phase.schedule.type === "interval" ? phase.schedule.everyDays : null,
    weekdays: phase.schedule.type === "weekdays" ? phase.schedule.days : null,
    dose_change_from: (phase.doseChanges ?? []).map((c) => c.from),
    dose_change_mg: (phase.doseChanges ?? []).map((c) => c.doseMg),
    time_change_from: (phase.timeChanges ?? []).map((c) => c.from),
    time_change_time: (phase.timeChanges ?? []).map((c) => c.time),
  };
}

const confirmationJson = (confirmations: Confirmation[]) =>
  JSON.stringify(
    confirmations.map((c) => ({
      key: c.key,
      actual_at: String(c.actualAt),
      recorded_at: String(c.recordedAt),
      ...(c.scheduledAt !== undefined ? { scheduled_at: String(c.scheduledAt) } : {}),
    })),
  );

function databaseRows(cases: Case[]): Record<string, string[]> {
  const sql = cases
    .map(
      ({ label, zone, planId, phase, confirmations }) =>
        `select ${quote(label)}, coalesce(string_agg(o.occurrence_key || '@' || ${sqlMicros("o.scheduled_at")} || '@' || coalesce(${sqlMicros("o.actual_at")}, '-') || '@' || o.dose_mg::text || '@' || o.local_date::text, ','), '')
         from public.cycle_phase_occurrences(jsonb_populate_record(null::public.cycle_revision_phases, ${quote(JSON.stringify(phaseRow(phase)))}::jsonb),
              ${quote(zone)}, ${quote(planId)}::uuid, ${quote(confirmationJson(confirmations))}::jsonb) o;`,
    )
    .join("\n");
  const out = psql(sql);
  return Object.fromEntries(cases.map(({ label }) => [label, (out[label] ?? "").split(",").filter(Boolean).sort()]));
}

function engineRows({ zone, planId, phase, confirmations }: Case): string[] {
  return scheduleOccurrences({ planId, timeZone: zone, phases: [phase] }, confirmations)
    .map((o) => `${o.key}@${micros(o.scheduledAt)}@${o.actualAt ? micros(o.actualAt) : "-"}@${o.doseMg}@${o.localDate}`)
    .sort();
}

/**
 * A researcher confirming doses over time: at each step the clock moves on,
 * and one or two doses already due (or due later that day) are confirmed at
 * an actual time from a day before their planned time up to now, recorded
 * now, with the scheduled time the engine gave them then.
 */
function simulate(random: () => number, planId: string, zone: string, phase: ActivePhase): Confirmation[] {
  const confirmations: Confirmation[] = [];
  let clock = Temporal.PlainDate.from(phase.start).toZonedDateTime({ timeZone: zone }).toInstant().subtract({ hours: 12 });
  const end = Temporal.PlainDate.from(phase.end).add({ days: 4 }).toZonedDateTime({ timeZone: zone }).toInstant();
  while (Temporal.Instant.compare(clock, end) < 0) {
    clock = clock.add({ minutes: Math.floor(random() * 3 * 24 * 60) + 30 });
    const open = scheduleOccurrences({ planId, timeZone: zone, phases: [phase] }, confirmations).filter(
      (o) => !o.actualAt && Temporal.Instant.compare(Temporal.Instant.from(o.scheduledAt).subtract({ hours: 12 }), clock) <= 0,
    );
    if (open.length === 0 || random() < 0.25) continue;
    const picks = random() < 0.2 && open.length > 1 ? [open[0], open[open.length - 1]] : [open[Math.floor(random() * open.length)]];
    for (const o of picks) {
      const earliest = Temporal.Instant.from(o.scheduledAt).subtract({ hours: 24 }).epochMilliseconds;
      const latest = clock.epochMilliseconds;
      const actual = Temporal.Instant.fromEpochMilliseconds(earliest + Math.floor(random() * Math.max(0, latest - earliest)));
      confirmations.push({ key: o.key, actualAt: actual.toString(), recordedAt: clock.toString(), scheduledAt: o.scheduledAt });
    }
  }
  return confirmations;
}

/** Arbitrary confirmations: any index (some past the phase), any times, often without a scheduled time. */
function arbitrary(random: () => number, planId: string, zone: string, phase: ActivePhase, count: number): Confirmation[] {
  const start = Temporal.PlainDate.from(phase.start).toZonedDateTime({ timeZone: zone }).toInstant();
  const days = Temporal.PlainDate.from(phase.start).until(phase.end).days + 6;
  const keys = new Set<string>();
  const out: Confirmation[] = [];
  const recordings = [0, 1, 2].map(() => start.add({ minutes: Math.floor(random() * days * 24 * 60) }));
  for (let n = 0; n < count; n++) {
    const suffix =
      phase.schedule.type === "interval"
        ? String(Math.floor(random() * (days / phase.schedule.everyDays + 3)))
        : Temporal.PlainDate.from(phase.start).add({ days: Math.floor(random() * days) }).toString();
    const key = `${planId}:${phase.id}:${suffix}`;
    if (keys.has(key)) continue;
    keys.add(key);
    // A third of them share a recording instant with another.
    const recorded = random() < 0.35 ? recordings[Math.floor(random() * 3)] : start.add({ minutes: Math.floor(random() * days * 24 * 60) });
    const actual = recorded.subtract({ minutes: Math.floor(random() * 5 * 24 * 60) });
    out.push({
      key,
      actualAt: actual.toString(),
      recordedAt: recorded.toString(),
      ...(random() < 0.5 ? { scheduledAt: actual.add({ minutes: Math.floor(random() * 600) }).toString() } : {}),
    });
  }
  return out;
}

function randomPhase(random: () => number, weekly: boolean): ActivePhase {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const start = Temporal.PlainDate.from(pick(STARTS)).add({ days: int(0, 5) });
  const end = start.add({ days: int(4, 30) });
  const between = () => start.add({ days: int(1, end.since(start).days) }).toString();
  const timeFroms = [...new Set(Array.from({ length: int(0, 2) }, between))].sort();
  const doseFroms = [...new Set(Array.from({ length: int(0, 2) }, between))].sort();
  return {
    id: randomUUID(),
    kind: "active",
    start: start.toString(),
    end: end.toString(),
    doseMg: "0.25",
    time: pick(TIMES),
    schedule: weekly
      ? { type: "weekdays", days: [...new Set([int(0, 6), int(0, 6), int(0, 6)])].sort() as Weekday[] }
      : { type: "interval", everyDays: int(1, 4) },
    ...(timeFroms.length ? { timeChanges: timeFroms.map((from) => ({ from, time: pick(TIMES) })) } : {}),
    ...(doseFroms.length ? { doseChanges: doseFroms.map((from, i) => ({ from, doseMg: ["0.5", "1.125", "2"][i] })) } : {}),
  };
}

describe("the database's schedule with recorded doses matches the engine's", () => {
  it("for a researcher confirming doses over time (late, early, backdated, together)", () => {
    const random = mulberry32(1212);
    const cases: Case[] = [];
    for (let n = 0; n < 50; n++) {
      const zone = ZONES[n % ZONES.length];
      const planId = randomUUID();
      const phase = randomPhase(random, n % 5 === 4);
      cases.push({ label: `s${n}`, zone, planId, phase, confirmations: simulate(random, planId, zone, phase) });
    }
    expect(cases.reduce((total, c) => total + c.confirmations.length, 0)).toBeGreaterThan(150);
    const database = databaseRows(cases);
    for (const c of cases) expect(database[c.label], `${c.label} ${c.zone} ${JSON.stringify(c.phase)} ${JSON.stringify(c.confirmations)}`).toEqual(engineRows(c));
    // Not vacuous: most confirmations landed, and re-anchoring moved doses off the planned rhythm.
    const confirmed = Object.values(database).flat().filter((row) => !row.includes("@-@"));
    expect(confirmed.length).toBeGreaterThan(150);
    const offRhythm = cases.filter((c) => engineRows({ ...c, confirmations: [] }).join() !== engineRows(c).map((row) => row.replace(/@[^@]+@([^@]+@[^@]+)$/, "@-@$1")).join());
    expect(offRhythm.length).toBeGreaterThan(10);
  });

  it("for arbitrary confirmations, including past the phase end and without scheduled times", () => {
    const random = mulberry32(4242);
    const cases: Case[] = [];
    for (let n = 0; n < 50; n++) {
      const zone = ZONES[n % ZONES.length];
      const planId = randomUUID();
      const phase = randomPhase(random, n % 4 === 3);
      cases.push({ label: `a${n}`, zone, planId, phase, confirmations: arbitrary(random, planId, zone, phase, 1 + (n % 7)) });
    }
    const database = databaseRows(cases);
    for (const c of cases) expect(database[c.label], `${c.label} ${c.zone} ${JSON.stringify(c.phase)} ${JSON.stringify(c.confirmations)}`).toEqual(engineRows(c));
  });
});
